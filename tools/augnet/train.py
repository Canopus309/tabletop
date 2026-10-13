"""학습: 자기 대국 기록(data/*.bin)이 일정량 새로 쌓일 때마다 신경망을 학습하고 models/gen_XXXX.pt 로 저장한다.
최근 기록 창(WINDOW 장면)에서 고르게 뽑아 학습한다. 손실은 KataGo 식: 정책(착수·대상·쓰기) · 승패 · 집 차이 · 소유.
새로 붙인 증강 부분은 학습률을 10배로 (나머지는 KataGo 를 크게 흔들지 않게 작게).
사용: python train.py [--every 20000] [--window 300000]   (STOP 파일이 생기면 멈춤)
"""
import glob, json, os, sys, time
for _k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):   # CPU 스레드를 줄여 열을 덜 낸다
    os.environ[_k] = "2"
import numpy as np
import torch
import torch.nn.functional as F
sys.path.insert(0, os.path.dirname(__file__))
from model import from_katago, save, NF, NF2, NG2

HERE = os.path.dirname(os.path.abspath(__file__))
# 어느 KataGo 를 바탕으로 하나: 환경 변수 AUGNET_NET = b10 (기본, data/ · models/) 또는 b15 (data-b15/ · models-b15/)
NET = os.environ.get('AUGNET_NET', 'b10')
BASE = os.path.join(HERE, '..', '..', 'go', 'models', {'b10': 'g170e-b10c128.bin.gz', 'b15': 'g170e-b15c192.bin.gz'}[NET])
SUF = '' if NET == 'b10' else '-' + NET
DATA = os.environ.get('AUGNET_DATA_DIR') or os.path.join(HERE, 'data' + SUF)
MODELS = os.environ.get('AUGNET_MODELS_DIR') or os.path.join(HERE, 'models' + SUF)
arg = lambda k, d: type(d)(sys.argv[sys.argv.index('--' + k) + 1]) if '--' + k in sys.argv else d
EVERY, WINDOW, BATCH = arg('every', 10000), arg('window', 300000), 256
n = 9; area = n * n
IN = area * NF2 + NG2; SAMPLE = IN + (2 * area + 2) + 2 + area
dev = torch.device('cuda')
torch.set_num_threads(2)
os.makedirs(MODELS, exist_ok=True)


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# 시작 가중치: 마지막 세대, 없으면 KataGo (증강 0) 를 0세대로 저장
net = from_katago(BASE)
gen = 0
latest = os.path.join(MODELS, 'latest.txt')
if os.path.exists(latest):
    name = open(latest).read().strip()
    net.load_state_dict(torch.load(os.path.join(MODELS, name), map_location='cpu', weights_only=False)['state'])
    gen = int(name[4:8])
else:
    save(net, os.path.join(MODELS, 'gen_0000.pt'), {'gen': 0}); open(latest, 'w').write('gen_0000.pt')
net = net.to(dev).train()

new_names = {'conv1_w', 'mat1', 't2_w', 't2_b', 'act_w', 'act_b'}
base_p = [p for k, p in net.named_parameters() if k not in new_names]
new_p = [p for k, p in net.named_parameters() if k in new_names]
LR_BASE = float(os.environ.get('AUGNET_LR', '2e-5' if NET != 'b10' else '4e-5'))
opt = torch.optim.AdamW([{'params': base_p, 'lr': LR_BASE}, {'params': new_p, 'lr': LR_BASE * 10}], weight_decay=1e-5)

# 선생: 원래 KataGo (증강을 모름, 고정). 판 위에 증강 흔적이 없는 장면에서 착수 정책이 선생에게서 너무 멀어지지 않게 한다 (기본기 지키기).
# 증강을 쓸지 · 어디에 쓸지(대상 칸 · 지금 쓰기)는 묶지 않는다. b10 은 예전처럼 선생 없이.
TEACH = float(os.environ.get('AUGNET_TEACH', '0' if NET == 'b10' else '0.5'))
teacher = None
if TEACH > 0:
    teacher = from_katago(BASE).to(dev).eval()
    for p in teacher.parameters():
        p.requires_grad_(False)
scaler = torch.amp.GradScaler('cuda')

files, arrays = [], []   # 읽은 기록 파일과 내용 (최근 창만 유지)
loaded = set()           # 한 번이라도 읽은 파일 (창에서 빠진 옛 파일을 다시 '새 기록'으로 읽지 않게)
seen_total = 0


def load_new():
    global seen_total
    got = 0
    for f in sorted(glob.glob(os.path.join(DATA, '*.bin')), key=os.path.getmtime):
        if f in loaded:
            continue
        a = np.fromfile(f, dtype='<f4')
        if a.size % SAMPLE:
            continue
        loaded.add(f); files.append(f); arrays.append(a.reshape(-1, SAMPLE)); got += a.size // SAMPLE
    seen_total += got
    while sum(len(a) for a in arrays) - (len(arrays[0]) if arrays else 0) > WINDOW:
        files.pop(0); arrays.pop(0)
    return got


def train_round(steps):
    sizes = np.array([len(a) for a in arrays]); ends = np.cumsum(sizes); total = int(ends[-1])
    tot = {'pol': 0, 'val': 0, 'score': 0, 'own': 0, 'teach': 0}
    for s in range(steps):
        g = np.sort(np.random.randint(0, total, BATCH)); k = np.searchsorted(ends, g, side='right')
        rows = [arrays[ki][gi - (ends[ki] - sizes[ki])] for ki, gi in zip(k, g)]
        x = torch.from_numpy(np.stack(rows)).to(dev)
        bin_ = x[:, :area * NF2].reshape(BATCH, n, n, NF2); glob_ = x[:, area * NF2:IN]
        pi = x[:, IN:IN + 2 * area + 2]; z = x[:, IN + 2 * area + 2]; sc = x[:, IN + 2 * area + 3]; own_t = x[:, IN + 2 * area + 4:]
        with torch.autocast('cuda', dtype=torch.float16):
            pol, tgt, act, val, misc, own = net(bin_, glob_)
        logits = torch.cat([pol.float(), tgt.float(), act.float()[:, None]], 1)
        l_pol = -(pi * F.log_softmax(logits, 1)).sum(1).mean()
        vt = torch.stack([(z > 0).float(), (z < 0).float(), torch.zeros_like(z)], 1)
        l_val = -(vt * F.log_softmax(val.float(), 1)).sum(1).mean()
        l_sc = F.huber_loss(misc.float()[:, 0] * 20, sc, delta=10) / 20 + F.huber_loss(misc.float()[:, 2] * 20, sc, delta=10) / 20
        l_own = F.mse_loss(own.float(), own_t)
        loss = l_pol + 1.5 * l_val + 0.5 * l_sc + 0.5 * l_own
        if teacher is not None:
            plain = (bin_[..., NF:].abs().sum((1, 2, 3)) == 0)   # 무적 · 결계 · 단계 · 맞바꾸기 표시가 없는 장면
            if plain.any():
                with torch.no_grad(), torch.autocast('cuda', dtype=torch.float16):
                    tp = teacher(bin_[plain], glob_[plain])[0].float()
                lt = F.log_softmax(tp, 1)
                l_t = (lt.exp() * (lt - F.log_softmax(pol.float()[plain], 1))).sum(1).mean()
                loss = loss + TEACH * l_t; tot['teach'] += l_t.item()
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt); torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        scaler.step(opt); scaler.update()
        tot['pol'] += l_pol.item(); tot['val'] += l_val.item(); tot['score'] += l_sc.item(); tot['own'] += l_own.item()
    return {k: v / steps for k, v in tot.items()}, total


stop = os.path.join(HERE, 'STOP')
# 다시 시작할 때: 이미 학습한 기록은 '새 기록'으로 치지 않는다 (마지막 세대 저장 뒤에 생긴 것만)
load_new()
last_t = os.path.getmtime(os.path.join(MODELS, open(latest).read().strip()))
pending = sum(len(a) for f, a in zip(files, arrays) if os.path.getmtime(f) > last_t)
log('학습 시작 · 세대', gen, '· 새 기록', EVERY, '장면마다')
while not os.path.exists(stop):
    pending += load_new()
    if pending < EVERY:
        time.sleep(30); continue
    steps = max(150, pending * 4 // BATCH)
    t0 = time.time()
    loss, wsize = train_round(steps)
    gen += 1; pending = 0
    name = f'gen_{gen:04d}.pt'
    net.eval(); save(net, os.path.join(MODELS, name), {'gen': gen, 'loss': loss, 'seen': seen_total}); net.train()
    open(latest + '.tmp', 'w').write(name); os.replace(latest + '.tmp', latest)
    rec = {'gen': gen, 'steps': steps, 'window': wsize, 'seen': seen_total, 'sec': round(time.time() - t0), **{k: round(v, 4) for k, v in loss.items()}, 't': time.strftime('%m-%d %H:%M')}
    open(os.path.join(MODELS, 'train-log.jsonl'), 'a').write(json.dumps(rec) + '\n')
    log('세대', gen, rec)
log('학습 멈춤')
