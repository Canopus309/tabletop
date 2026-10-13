"""신경망 계산 서버: 자기 대국(selfplay.js)이 보낸 장면들을 묶어 GPU 로 한 번에 계산한다.
요청: [개수 uint32][판 크기 uint32] + 개수 × (area*NF2 + NG2) float32
응답: 개수 × OUT float32 = 정책(area+1) · 대상(area) · 쓰기(1) · 가치(3) · misc(4) · 소유(area)
models/latest.txt 가 바뀌면 새 가중치를 읽는다 (학습 train.py 가 씀)
사용: python server.py [--port 19190]
"""
import asyncio, os, struct, sys, time
# CPU 스레드를 하나로: 기본값이면 계산을 기다리며 CPU 코어 여러 개를 헛돌려 노트북이 뜨거워진다 (2026-10-13 온도 문제)
for _k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_k] = "1"
import numpy as np
import torch
sys.path.insert(0, os.path.dirname(__file__))
from model import from_katago, NF2, NG2

HERE = os.path.dirname(os.path.abspath(__file__))
# 어느 KataGo 를 바탕으로 하나: 환경 변수 AUGNET_NET = b10 (기본, data/ · models/) 또는 b15 (data-b15/ · models-b15/)
NET = os.environ.get('AUGNET_NET', 'b10')
BASE = os.path.join(HERE, '..', '..', 'go', 'models', {'b10': 'g170e-b10c128.bin.gz', 'b15': 'g170e-b15c192.bin.gz'}[NET])
SUF = '' if NET == 'b10' else '-' + NET
MODELS = os.path.join(HERE, 'models' + SUF)
PORT = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 19190
PIN = sys.argv[sys.argv.index('--model') + 1] if '--model' in sys.argv else ''   # 대결용: 이 가중치로 고정 (latest.txt 를 따르지 않음)
MAXB = 1024
dev = torch.device("cuda")
torch.set_num_threads(1)

net = from_katago(BASE).to(dev).eval()
cur = ''


def maybe_reload():
    global cur
    try:
        name = PIN or open(os.path.join(MODELS, 'latest.txt')).read().strip()
    except FileNotFoundError:
        return
    if name == 'katago':   # 증강을 모르는 처음 KataGo 그대로
        return
    if name and name != cur:
        ck = torch.load(os.path.join(MODELS, name), map_location='cpu', weights_only=False)
        net.load_state_dict(ck['state'])
        cur = name
        print(time.strftime('%H:%M:%S'), '가중치', name, flush=True)


queue = asyncio.Queue()
clients = {'n': 0}
stats = {'evals': 0, 'batches': 0, 't0': time.time()}


async def batcher():
    last_check = 0
    while True:
        first = await queue.get()
        items = [first]; total = first[1]
        t_end = time.perf_counter() + 0.002
        while total < MAXB:
            try:
                it = queue.get_nowait()
            except asyncio.QueueEmpty:
                if time.perf_counter() > t_end:
                    break
                await asyncio.sleep(0.0003)
                continue
            items.append(it); total += it[1]
        n = items[0][2]; area = n * n
        x = np.concatenate([it[0] for it in items]).reshape(total, area * NF2 + NG2)
        bin_ = torch.from_numpy(x[:, :area * NF2].reshape(total, n, n, NF2)).to(dev, non_blocking=True)
        glob = torch.from_numpy(x[:, area * NF2:]).to(dev, non_blocking=True)
        with torch.inference_mode(), torch.autocast('cuda', dtype=torch.float16):
            pol, tgt, act, val, misc, own = net(bin_, glob)
        out = torch.cat([pol.float(), tgt.float(), act.float()[:, None], val.float(), misc.float()[:, :4], own.float()], 1).cpu().numpy()
        k = 0
        for it in items:
            it[3].set_result(out[k:k + it[1]]); k += it[1]
        stats['evals'] += total; stats['batches'] += 1
        if time.time() - last_check > 20:
            last_check = time.time(); maybe_reload()
            dt = time.time() - stats['t0']
            print(time.strftime('%H:%M:%S'), f"초당 {stats['evals'] / dt:.0f}장면 · 평균 묶음 {stats['evals'] / max(1, stats['batches']):.0f}", flush=True)
            stats.update(evals=0, batches=0, t0=time.time())


async def handle(reader, writer):
    loop = asyncio.get_running_loop()
    clients['n'] += 1
    try:
        while True:
            hdr = await reader.readexactly(8)
            cnt, n = struct.unpack('<II', hdr)
            data = await reader.readexactly(cnt * (n * n * NF2 + NG2) * 4)
            fut = loop.create_future()
            await queue.put((np.frombuffer(data, dtype='<f4'), cnt, n, fut))
            res = await fut
            writer.write(res.astype('<f4').tobytes())
            await writer.drain()
    except (asyncio.IncompleteReadError, ConnectionResetError):
        pass
    finally:
        clients['n'] -= 1
        writer.close()


async def watch_stop():
    # STOP 이 생겨도 자기 대국 일꾼이 두던 판을 마치고 모두 떠날 때까지 (최대 15분) 기다린다
    while not os.path.exists(os.path.join(HERE, 'STOP')):
        await asyncio.sleep(10)
    t = time.time()
    while clients['n'] > 0 and time.time() - t < 900:
        await asyncio.sleep(5)
    print(time.strftime('%H:%M:%S'), 'STOP: 서버 끝', flush=True)
    os._exit(0)


async def main():
    maybe_reload()
    asyncio.create_task(batcher())
    asyncio.create_task(watch_stop())
    srv = await asyncio.start_server(handle, '127.0.0.1', PORT)
    print(time.strftime('%H:%M:%S'), '신경망 서버 시작', PORT, '가중치', cur or 'KataGo b10 (증강 0)', flush=True)
    async with srv:
        await srv.serve_forever()

asyncio.run(main())
