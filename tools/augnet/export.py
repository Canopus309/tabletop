"""학습한 증강 신경망을 앱용 파일로: go/aug/models/augnet9.bin (앱의 go/aug/ai.js 가 읽음)
형식: b'AUGNET1\\n' + 머리말 길이(uint32) + 머리말 JSON + (4바이트 맞춤) + float16 가중치
합성곱은 TF.js 순서 [ky, kx, ic, oc] 로, 행렬은 [ic, oc] 그대로.
사용: python export.py [--net b10] [--gen gen_0172.pt] [--out ../../go/aug/models/augnet9.bin]
"""
import json, os, struct, sys
import numpy as np
import torch
sys.path.insert(0, os.path.dirname(__file__))
from model import from_katago, NF2, NG2

HERE = os.path.dirname(os.path.abspath(__file__))
arg = lambda k, d: sys.argv[sys.argv.index('--' + k) + 1] if '--' + k in sys.argv else d
NET = arg('net', 'b10')
BASE = os.path.join(HERE, '..', '..', 'go', 'models', {'b10': 'g170e-b10c128.bin.gz', 'b15': 'g170e-b15c192.bin.gz'}[NET])
MODELS = os.path.join(HERE, 'models' + ('' if NET == 'b10' else '-' + NET))
GEN = arg('gen', open(os.path.join(MODELS, 'latest.txt')).read().strip())
OUT = arg('out', os.path.join(HERE, '..', '..', 'go', 'aug', 'models', 'augnet9.bin'))

net = from_katago(BASE)
net.load_state_dict(torch.load(os.path.join(MODELS, GEN), map_location='cpu', weights_only=False)['state'])
net.eval()

tensors, chunks, off = {}, [], 0


def put(name, t, conv=False):
    global off
    a = t.detach().float().numpy()
    if conv:
        a = a.transpose(2, 3, 1, 0)  # [oc, ic, ky, kx] → [ky, kx, ic, oc]
    a = np.ascontiguousarray(a, 'f4')
    assert np.abs(a).max() < 60000, name
    tensors[name] = [off, list(a.shape)]
    chunks.append(a.astype('<f2').tobytes()); off += a.size


put('conv1', net.conv1_w, True); put('mat1', net.mat1)
blocks = []
for i, (b, g) in enumerate(zip(net.blocks, net.kinds)):
    p = f'b{i}.'
    put(p + 'pre_mul', b.pre_mul); put(p + 'pre_add', b.pre_add)
    if g:
        put(p + 'gc_w', b.gc.w, True); put(p + 'gc_b', b.gc.b)
        put(p + 'c1_w', b.c1.w, True); put(p + 'mm', b.mm); put(p + 'mm_add', b.mm_add)
        blocks.append({'g': True, 'pre': b.pre_act, 'gc': b.gc_act, 'c1': b.c1_act})
    else:
        put(p + 'c1_w', b.c1.w, True); put(p + 'c1_b', b.c1.b)
        blocks.append({'g': False, 'pre': b.pre_act, 'c1': b.c1_act})
    put(p + 'c2_w', b.c2.w, True)
put('tip_mul', net.tip_mul); put('tip_add', net.tip_add)
put('g1_w', net.g1.w, True); put('g1_b', net.g1.b)
put('p1_w', net.p1.w, True); put('p1_mm', net.p1_mm); put('p1_add', net.p1_add)
put('p2_w', net.p2.w, True); put('to_pass', net.to_pass)
put('t2_w', net.t2_w, True); put('t2_b', net.t2_b)
put('act_w', net.act_w); put('act_b', net.act_b)
put('v1_w', net.v1.w, True); put('v1_b', net.v1.b)
put('v2', net.v2); put('v2b', net.v2b); put('v3', net.v3); put('v3b', net.v3b); put('sv3', net.sv3); put('sv3b', net.sv3b)
put('own_w', net.own.w, True)

head = {'name': f'augnet-{NET}-{GEN.replace(".pt", "")}', 'nf': NF2, 'ng': NG2, 'blocks': blocks,
        'act': {'tip': net.tip_act, 'g1': net.g1_act, 'p1': net.p1_act, 'v1': net.v1_act, 'v2': net.v2_act}, 'tensors': tensors}
hj = json.dumps(head, separators=(',', ':')).encode()
pad = (-(8 + 4 + len(hj))) % 4
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'wb') as f:
    f.write(b'AUGNET1\n'); f.write(struct.pack('<I', len(hj) + pad)); f.write(hj + b' ' * pad)
    for c in chunks:
        f.write(c)
print(head['name'], '→', OUT, f'{os.path.getsize(OUT) / 1e6:.1f}MB', off, '개 가중치')
