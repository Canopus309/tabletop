"""증강 바둑 신경망: KataGo b10 (앱의 g170e-b10c128, CC0) 를 파이토치로 옮기고 증강 입력·출력을 덧붙인다.

계산은 앱의 go/katago.js (buildNet) 와 똑같다: 배치 정규화는 앞 합성곱에 접어 넣은 채널별 곱·더하기로 둔다.
증강 덧붙임 (처음에는 0 → KataGo 와 똑같이 둠):
  입력 칸 6면: 내 무적 무리 · 상대 무적 무리 · 내 결계 점 · 상대 결계 점 · '증강을 쓰고 착수 대기' · '슈퍼선수 두 번째 수'
  입력 전역 14개: 내 증강 종류(6) · 내 증강 남음 · 상대 증강 종류(6) · 상대 증강 남음
  출력: 대상 칸 (무적수를 걸 돌 · 결계 점 · 저격할 돌) 한 면 + '지금 쓰기'(슈퍼선수 · 되감기) 값 하나
"""
import gzip, math
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

NF, NG = 22, 19            # KataGo 입력 (칸마다 · 전역)
AUG_NF, AUG_NG = 6, 14     # 증강 덧붙임
NF2, NG2 = NF + AUG_NF, NG + AUG_NG


# ---------------- KataGo .bin(.gz) 읽기 (katago.js 의 Reader · parseModel 과 같음) ----------------
class Reader:
    def __init__(self, data):
        self.d, self.i = data, 0

    def ws(self):
        d = self.d
        while self.i < len(d) and d[self.i] in (32, 10, 13, 9):
            self.i += 1

    def tok(self):
        self.ws(); s = self.i; d = self.d
        while self.i < len(d) and d[self.i] not in (32, 10, 13, 9):
            self.i += 1
        if self.i == s:
            raise ValueError('모델 파일이 잘렸습니다')
        return d[s:self.i].decode()

    def int(self): return int(self.tok())
    def num(self): return float(self.tok())

    def floats(self, n):
        self.ws(); i = self.i
        if self.d[i:i + 5] != b'@BIN@':
            raise ValueError('@BIN@ 표식이 없습니다')
        a = np.frombuffer(self.d, dtype='<f4', count=n, offset=i + 5).copy()
        self.i = i + 5 + n * 4
        return a


def parse_model(path):
    data = gzip.open(path, 'rb').read() if path.endswith('.gz') else open(path, 'rb').read()
    r = Reader(data)
    m = {'name': r.tok(), 'version': r.int(), 'nIn': r.int(), 'nGlob': r.int()}
    v = m['version']
    assert 8 <= v <= 11, v
    assert m['nIn'] == NF and m['nGlob'] == NG

    def conv():
        name = r.tok(); ky, kx, ic, oc, dy, dx = (r.int() for _ in range(6))
        return {'name': name, 'ky': ky, 'kx': kx, 'ic': ic, 'oc': oc, 'dy': dy, 'dx': dx, 'w': r.floats(ky * kx * ic * oc).reshape(ky, kx, ic, oc)}

    def bn():
        r.tok(); c = r.int(); eps = r.num(); has_s = r.int() != 0; has_b = r.int() != 0
        mean, var = r.floats(c), r.floats(c)
        sc = r.floats(c) if has_s else np.ones(c, 'f4')
        bi = r.floats(c) if has_b else np.zeros(c, 'f4')
        mul = sc / np.sqrt(var + eps)
        return {'c': c, 'mul': mul.astype('f4'), 'add': (bi - mul * mean).astype('f4')}

    def act():
        r.tok()
        if v >= 11:
            k = r.tok()
            return 'mish' if k == 'ACTIVATION_MISH' else 'id' if k == 'ACTIVATION_IDENTITY' else 'relu'
        return 'relu'

    def matmul():
        r.tok(); ic, oc = r.int(), r.int()
        return {'ic': ic, 'oc': oc, 'w': r.floats(ic * oc).reshape(ic, oc)}

    def bias():
        r.tok(); c = r.int()
        return {'c': c, 'w': r.floats(c)}

    r.tok(); nb = r.int(); m['C'] = r.int(); [r.int() for _ in range(4)]
    m['conv1'] = conv(); m['mat1'] = matmul(); m['blocks'] = []
    for _ in range(nb):
        kind = r.tok(); r.tok()
        if kind == 'ordinary_block':
            m['blocks'].append({'kind': kind, 'preBN': bn(), 'preAct': act(), 'c1': conv(), 'midBN': bn(), 'midAct': act(), 'c2': conv()})
        elif kind == 'gpool_block':
            m['blocks'].append({'kind': kind, 'preBN': bn(), 'preAct': act(), 'c1': conv(), 'gc': conv(), 'gBN': bn(), 'gAct': act(), 'gMul': matmul(), 'midBN': bn(), 'midAct': act(), 'c2': conv()})
        else:
            raise ValueError(kind)
    m['tipBN'] = bn(); m['tipAct'] = act()
    r.tok(); m['p1'] = conv(); m['g1'] = conv(); m['g1BN'] = bn(); m['g1Act'] = act(); m['gToBias'] = matmul(); m['p1BN'] = bn(); m['p1Act'] = act(); m['p2'] = conv(); m['gToPass'] = matmul()
    r.tok(); m['v1'] = conv(); m['v1BN'] = bn(); m['v1Act'] = act(); m['v2'] = matmul(); m['v2b'] = bias(); m['v2Act'] = act()
    m['v3'] = matmul(); m['v3b'] = bias(); m['sv3'] = matmul(); m['sv3b'] = bias(); m['own'] = conv()
    return m


# ---------------- 신경망 ----------------
def actf(x, a):
    return F.relu(x) if a == 'relu' else x * torch.tanh(F.softplus(x)) if a == 'mish' else x


class Conv(nn.Module):
    """합성곱 (+ 접어 넣은 BN 의 채널별 곱·더하기는 가중치·편향에 미리 반영)"""
    def __init__(self, c, mul=None, add=None, bias=True):
        super().__init__()
        w = c['w'].transpose(3, 2, 0, 1).copy()  # [ky,kx,ic,oc] → [oc,ic,ky,kx]
        if mul is not None:
            w = w * mul[:, None, None, None]
        self.w = nn.Parameter(torch.from_numpy(w))
        self.b = nn.Parameter(torch.from_numpy(add.copy())) if (bias and add is not None) else None
        self.dil = (c['dy'], c['dx'])
        self.pad = ((c['ky'] - 1) // 2 * c['dy'], (c['kx'] - 1) // 2 * c['dx'])

    def forward(self, x):
        return F.conv2d(x, self.w, self.b, padding=self.pad, dilation=self.dil)


def lin(mm, mul=None):
    w = mm['w'].copy()  # [ic, oc]
    if mul is not None:
        w = w * mul[None, :]
    return nn.Parameter(torch.from_numpy(w))


def gpool(x, sq):  # [N,C,H,W] → [N,3C]: 평균 · 평균×(√칸수−14)/10 · 최댓값
    mean = x.mean((2, 3))
    return torch.cat([mean, mean * ((sq - 14) * 0.1), x.amax((2, 3))], 1)


def vpool(x, sq):
    mean = x.mean((2, 3))
    return torch.cat([mean, mean * ((sq - 14) * 0.1), mean * ((sq - 14) ** 2 * 0.01 - 0.1)], 1)


class AugNet(nn.Module):
    def __init__(self, m):
        super().__init__()
        C = m['C']
        # 입력: KataGo 채널 + 증강 채널 (0으로 시작)
        c1 = m['conv1']
        w = c1['w'].transpose(3, 2, 0, 1)
        w2 = np.zeros((w.shape[0], NF2, w.shape[2], w.shape[3]), 'f4'); w2[:, :NF] = w
        self.conv1_w = nn.Parameter(torch.from_numpy(w2)); self.conv1_pad = ((c1['ky'] - 1) // 2, (c1['kx'] - 1) // 2)
        g = np.zeros((NG2, C), 'f4'); g[:NG] = m['mat1']['w']
        self.mat1 = nn.Parameter(torch.from_numpy(g))
        self.blocks = nn.ModuleList()
        self.kinds = []
        for b in m['blocks']:
            mod = nn.Module()
            mod.pre_mul = nn.Parameter(torch.from_numpy(b['preBN']['mul'])); mod.pre_add = nn.Parameter(torch.from_numpy(b['preBN']['add'])); mod.pre_act = b['preAct']
            if b['kind'] == 'ordinary_block':
                mod.c1 = Conv(b['c1'], b['midBN']['mul'], b['midBN']['add']); mod.c1_act = b['midAct']
                self.kinds.append(False)
            else:
                mod.gc = Conv(b['gc'], b['gBN']['mul'], b['gBN']['add']); mod.gc_act = b['gAct']
                mod.c1 = Conv(b['c1'], b['midBN']['mul'], None, bias=False)
                mod.mm = lin(b['gMul'], b['midBN']['mul']); mod.mm_add = nn.Parameter(torch.from_numpy(b['midBN']['add'])); mod.c1_act = b['midAct']
                self.kinds.append(True)
            mod.c2 = Conv(b['c2'], bias=False)
            self.blocks.append(mod)
        self.tip_mul = nn.Parameter(torch.from_numpy(m['tipBN']['mul'])); self.tip_add = nn.Parameter(torch.from_numpy(m['tipBN']['add'])); self.tip_act = m['tipAct']
        # 정책
        self.g1 = Conv(m['g1'], m['g1BN']['mul'], m['g1BN']['add']); self.g1_act = m['g1Act']
        self.p1 = Conv(m['p1'], m['p1BN']['mul'], None, bias=False)
        self.p1_mm = lin(m['gToBias'], m['p1BN']['mul']); self.p1_add = nn.Parameter(torch.from_numpy(m['p1BN']['add'])); self.p1_act = m['p1Act']
        self.p2 = Conv(m['p2'], bias=False)
        self.to_pass = lin(m['gToPass'])
        pc = m['p1']['oc']
        # 증강 정책: 대상 칸 (p1 특징에서 1×1 합성곱) · 지금 쓰기 (정책 전역 풀링에서). 처음에는 거의 안 쓰게 (편향 -3)
        self.t2_w = nn.Parameter(torch.zeros(1, pc, 1, 1)); self.t2_b = nn.Parameter(torch.full((1,), -3.0))
        self.act_w = nn.Parameter(torch.zeros(m['gToPass']['ic'], 1)); self.act_b = nn.Parameter(torch.full((1,), -3.0))
        # 가치
        self.v1 = Conv(m['v1'], m['v1BN']['mul'], m['v1BN']['add']); self.v1_act = m['v1Act']
        self.v2 = lin(m['v2']); self.v2b = nn.Parameter(torch.from_numpy(m['v2b']['w'])); self.v2_act = m['v2Act']
        self.v3 = lin(m['v3']); self.v3b = nn.Parameter(torch.from_numpy(m['v3b']['w']))
        self.sv3 = lin(m['sv3']); self.sv3b = nn.Parameter(torch.from_numpy(m['sv3b']['w']))
        self.own = Conv(m['own'], bias=False)
        self.n_misc = m['sv3']['oc']

    def forward(self, bin_, glob):
        """bin_: [N, n, n, NF2] (katago.js 와 같은 칸 순서), glob: [N, NG2]
        반환: policy [N, area+1] (마지막 = 패스), target [N, area], act [N], value [N,3], misc [N,K], own [N, area]"""
        N, n = bin_.shape[0], bin_.shape[1]
        area = n * n; sq = math.sqrt(area)
        x = bin_.permute(0, 3, 1, 2)
        x = F.conv2d(x, self.conv1_w, padding=self.conv1_pad) + (glob @ self.mat1)[:, :, None, None]
        for b, g in zip(self.blocks, self.kinds):
            a = actf(x * b.pre_mul[None, :, None, None] + b.pre_add[None, :, None, None], b.pre_act)
            if g:
                gp = gpool(actf(b.gc(a), b.gc_act), sq)
                r = actf(b.c1(a) + (gp @ b.mm + b.mm_add)[:, :, None, None], b.c1_act)
            else:
                r = actf(b.c1(a), b.c1_act)
            x = x + b.c2(r)
        trunk = actf(x * self.tip_mul[None, :, None, None] + self.tip_add[None, :, None, None], self.tip_act)
        gp = gpool(actf(self.g1(trunk), self.g1_act), sq)
        p1 = actf(self.p1(trunk) + (gp @ self.p1_mm + self.p1_add)[:, :, None, None], self.p1_act)
        p2 = self.p2(p1)
        pol = p2[:, 0].reshape(N, area)
        pas = (gp @ self.to_pass)[:, :1]
        policy = torch.cat([pol, pas], 1)
        target = (F.conv2d(p1, self.t2_w) + self.t2_b).reshape(N, area)
        actv = (gp @ self.act_w + self.act_b)[:, 0]
        v1 = actf(self.v1(trunk), self.v1_act)
        v2 = actf(vpool(v1, sq) @ self.v2 + self.v2b, self.v2_act)
        value = v2 @ self.v3 + self.v3b
        misc = v2 @ self.sv3 + self.sv3b
        own = torch.tanh(self.own(v1)[:, 0].reshape(N, area))
        return policy, target, actv, value, misc, own


def from_katago(path):
    return AugNet(parse_model(path))


def save(net, path, meta=None):
    torch.save({'state': net.state_dict(), 'meta': meta or {}}, path)


def load(path, base_model):
    """저장한 학습 가중치를 읽는다 (구조는 KataGo 모델 파일에서 만든다)"""
    net = from_katago(base_model)
    ck = torch.load(path, map_location='cpu', weights_only=False)
    net.load_state_dict(ck['state'])
    return net, ck.get('meta', {})
