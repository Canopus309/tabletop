"""입력 2판(칸 29 · 전역 41, 증강 9가지) → 3판(칸 35 · 전역 71, 증강 자리 20) 으로 바꾼다. 배운 것은 그대로 두고 새 자리는 0.
- 학습 기록: data-b15-v2/*.bin → data-b15/*.bin (games.jsonl 도 복사)
- 가중치: models-b15/gen_*.pt 를 그 자리에서 바꾼다 (먼저 models-b15-v2bak 에 복사해 둘 것)
사용: python convert-v3.py
"""
import glob, os, shutil, sys
import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
n = 9; area = n * n
NF, NG = 22, 19
OLD_NF2, OLD_NG2 = 29, 41
NEW_NF2, NEW_NG2 = 35, 71
# 전역 증강 자리 옮기기: 2판 r → 3판 r (r 은 KataGo 전역 19 다음부터 센 번호)
GMAP = {r: r for r in range(9)}
GMAP.update({9: 20, 19: 41, 20: 42, 21: 43})
GMAP.update({10 + i: 21 + i for i in range(9)})
assert len(GMAP) == OLD_NG2 - NG


def conv_rows(old):  # [N, OLD_SAMPLE] → [N, NEW_SAMPLE]
    N = old.shape[0]
    tail = old[:, area * OLD_NF2 + OLD_NG2:]                 # 정책 · 결과 · 집 · 소유는 그대로
    b = old[:, :area * OLD_NF2].reshape(N, area, OLD_NF2)
    g = old[:, area * OLD_NF2: area * OLD_NF2 + OLD_NG2]
    nb = np.zeros((N, area, NEW_NF2), 'f4'); nb[:, :, :OLD_NF2] = b
    ng = np.zeros((N, NEW_NG2), 'f4'); ng[:, :NG] = g[:, :NG]
    for r2, r3 in GMAP.items():
        ng[:, NG + r3] = g[:, NG + r2]
    return np.concatenate([nb.reshape(N, -1), ng, tail], 1)


def data():
    src, dst = os.path.join(HERE, 'data-b15-v2'), os.path.join(HERE, 'data-b15')
    os.makedirs(dst, exist_ok=True)
    old_sample = area * OLD_NF2 + OLD_NG2 + (2 * area + 2) + 2 + area
    files = sorted(glob.glob(os.path.join(src, '*.bin')))
    for f in files:
        a = np.fromfile(f, '<f4')
        if a.size % old_sample:
            print('건너뜀 (크기)', f); continue
        out = conv_rows(a.reshape(-1, old_sample))
        t = os.path.join(dst, os.path.basename(f))
        out.astype('<f4').tofile(t + '.tmp'); os.replace(t + '.tmp', t)
        st = os.stat(f); os.utime(t, (st.st_atime, st.st_mtime))      # 시각도 그대로 (train.py 가 새 기록을 시각으로 셈)
    shutil.copy2(os.path.join(src, 'games.jsonl'), os.path.join(dst, 'games.jsonl'))
    print('기록', len(files), '파일')


def models():
    md = os.path.join(HERE, 'models-b15')
    for f in sorted(glob.glob(os.path.join(md, 'gen_*.pt'))):
        ck = torch.load(f, map_location='cpu', weights_only=False); sd = ck['state']
        w = sd['conv1_w']
        if w.shape[1] == NEW_NF2:
            continue
        nw = torch.zeros(w.shape[0], NEW_NF2, w.shape[2], w.shape[3], dtype=w.dtype); nw[:, :OLD_NF2] = w; sd['conv1_w'] = nw
        m = sd['mat1']; nm = torch.zeros(NEW_NG2, m.shape[1], dtype=m.dtype); nm[:NG] = m[:NG]
        for r2, r3 in GMAP.items():
            nm[NG + r3] = m[NG + r2]
        sd['mat1'] = nm
        st = os.stat(f); torch.save(ck, f); os.utime(f, (st.st_atime, st.st_mtime))
    print('가중치 바꿈')


if __name__ == '__main__':
    if 'data' in sys.argv: data()
    if 'models' in sys.argv: models()
