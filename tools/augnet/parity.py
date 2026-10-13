"""맞대기 시험: 파이토치로 옮긴 신경망(model.py)에 parity-inputs.js 가 만든 입력을 넣어 출력을 tmp/parity-py.json 에 쓴다.
브라우저의 앱(TF.js)이 같은 입력으로 낸 출력과 비교한다. 증강 채널은 0 으로 채운다 (그래도 KataGo 와 같아야 함)"""
import json, os, sys
import numpy as np
import torch
sys.path.insert(0, os.path.dirname(__file__))
from model import from_katago, NF, NG, NF2, NG2

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, '..', '..')
data = json.load(open(os.path.join(here, 'tmp', 'parity-in.json')))
n = data['n']; area = n * n
net = from_katago(os.path.join(root, 'go', 'models', 'g170e-b10c128.bin.gz')).eval()
bins, globs = [], []
for c in data['cases']:
    b = np.zeros((n, n, NF2), 'f4'); b[:, :, :NF] = np.array(c['bin'], 'f4').reshape(n, n, NF)
    g = np.zeros(NG2, 'f4'); g[:NG] = c['glob']
    bins.append(b); globs.append(g)
with torch.no_grad():
    pol, tgt, act, val, misc, own = net(torch.from_numpy(np.stack(bins)), torch.from_numpy(np.stack(globs)))
out = {'policy': pol.tolist(), 'value': val.tolist(), 'misc': misc.tolist(), 'own': own.tolist(), 'target': tgt.tolist(), 'act': act.tolist()}
json.dump(out, open(os.path.join(here, 'tmp', 'parity-py.json'), 'w'))
print('파이토치 출력 저장', len(bins), '장면 · 가치(첫 장면)', [round(v, 3) for v in val[0].tolist()], '· misc 개수', misc.shape[1])
