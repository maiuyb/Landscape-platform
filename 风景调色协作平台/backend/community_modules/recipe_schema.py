# -*- coding: utf-8 -*-
"""配方校验：按编辑器的配方格式（版本 1–7）校验发布内容。

对齐主编辑器 `editor-core.js` 的 `recipeState` 所接受的操作与范围，
但策略更严格：未知操作、非有限数值、越界值一律拒绝（400），
不通过删除步骤或改写版本号来“兼容”。

被 community.py 的发布接口复用；存储与返回结构见 repository.py。
"""

import math
import re

# 支持的配方版本（editor-core.recipeState 允许 1–7）
VERSIONS = {1, 2, 3, 4, 5, 6, 7}

# 全局调整控制（type 即键名），params.value 的范围
CONTROL_RANGES = {
    'exposure': (-3.0, 3.0),      # 版本 ≥2 时以 EV 计；版本 1 用 -100~100
    'contrast': (-100.0, 100.0),
    'highlights': (-100.0, 100.0),
    'shadows': (-100.0, 100.0),
    'whites': (-100.0, 100.0),
    'blacks': (-100.0, 100.0),
    'brightness': (-100.0, 100.0),
    'temperature': (-100.0, 100.0),
    'tint': (-100.0, 100.0),
    'saturation': (-100.0, 100.0),
    'vibrance': (-100.0, 100.0),
}
CONTROL_KEYS = set(CONTROL_RANGES)
# 版本 1 不含 white/blacks/vibrance（editor: legacyKeys）
LEGACY_KEYS = CONTROL_KEYS - {'whites', 'blacks', 'vibrance'}

DETAIL_RANGES = {
    'sharpen': (0.0, 100.0),
    'radius': (0.5, 3.0),
    'protection': (0.0, 100.0),
    'luminance': (0.0, 100.0),
    'color': (0.0, 100.0),
}

HSL_BANDS = {'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'}
CURVE_CHANNELS = {'master', 'red', 'green', 'blue'}
FILTER_NAMES = {'clarity', 'warm-autumn', 'film', 'cool-tone', 'bw', 'vivid'}

EFFECTS_RANGES = {'clarity': (-100.0, 100.0), 'dehaze': (-100.0, 100.0)}
VIGNETTE_RANGES = {
    'amount': (-100.0, 100.0), 'midpoint': (0.0, 100.0), 'feather': (0.0, 100.0),
    'roundness': (0.0, 100.0), 'centerX': (0.0, 100.0), 'centerY': (0.0, 100.0),
}
CALIBRATION_KEYS = ('red', 'green', 'blue')

MASK_TYPES = {'brush', 'linear', 'radial'}
MASK_ADJ_RANGES = {
    'exposure': (-3.0, 3.0), 'contrast': (-100.0, 100.0), 'highlights': (-100.0, 100.0),
    'shadows': (-100.0, 100.0), 'temperature': (-100.0, 100.0), 'tint': (-100.0, 100.0),
    'saturation': (-100.0, 100.0), 'clarity': (-100.0, 100.0), 'dehaze': (-100.0, 100.0),
}
MASK_LIMITS = {'layers': 6, 'strokes': 64, 'points': 4096, 'strokePoints': 512}

MAX_STEPS = 500
_MASK_ID_RE = re.compile(r'^[\w-]{1,64}$')


def _num(value):
    """有限数值（排除 bool / None / NaN / ±Inf）。"""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_choice(value, allowed):
    """字符串枚举判断；避免把 list/dict 等不可哈希值丢进 set 触发 TypeError(500)。"""
    return isinstance(value, str) and value in allowed


def _in(value, bounds):
    return _num(value) and bounds[0] <= value <= bounds[1]


def _norm_version(raw):
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
        return None
    if float(raw).is_integer() and int(raw) in VERSIONS:
        return int(raw)
    return None


def _valid_point(pt):
    return isinstance(pt, list) and len(pt) == 2 and all(_num(v) and 0 <= v <= 1 for v in pt)


def _valid_curve(points):
    if not isinstance(points, list) or not (2 <= len(points) <= 10):
        return False
    prev = None
    for p in points:
        if not (isinstance(p, list) and len(p) == 2 and all(_num(x) and 0 <= x <= 1 for x in p)):
            return False
        if prev is not None and p[0] - prev < 0.001 - 1e-9:
            return False
        prev = p[0]
    return points[0][0] == 0 and points[-1][0] == 1


def _validate_effects(p):
    if not isinstance(p, dict):
        return 'effects 参数无效'
    for key, bounds in EFFECTS_RANGES.items():
        if not _in(p.get(key), bounds):
            return 'effects.%s 数值无效' % key
    cal = p.get('calibration')
    if not isinstance(cal, dict):
        return 'effects.calibration 无效'
    for key in CALIBRATION_KEYS:
        entry = cal.get(key)
        if not isinstance(entry, dict):
            return 'effects.calibration.%s 无效' % key
        for sub in ('hue', 'saturation'):
            if not _num(entry.get(sub)) or abs(entry[sub]) > 100:
                return 'effects.calibration.%s.%s 无效' % (key, sub)
    vig = p.get('vignette')
    if not isinstance(vig, dict):
        return 'effects.vignette 无效'
    if 'profile' in vig and vig['profile'] not in ('legacy', 'corner'):
        return 'effects.vignette.profile 无效'
    for key, bounds in VIGNETTE_RANGES.items():
        if not _in(vig.get(key), bounds):
            return 'effects.vignette.%s 无效' % key
    return None


def _valid_mask(m):
    if not isinstance(m, dict):
        return False
    if not (isinstance(m.get('id'), str) and _MASK_ID_RE.match(m['id'])):
        return False
    if not (isinstance(m.get('name'), str) and len(m['name']) <= 60):
        return False
    if not _is_choice(m.get('type'), MASK_TYPES):
        return False
    if not isinstance(m.get('visible'), bool) or not isinstance(m.get('invert'), bool):
        return False
    if not _in(m.get('opacity'), (0.0, 100.0)) or not _in(m.get('feather'), (0.0, 100.0)):
        return False
    for key in ('start', 'end', 'center', 'radius'):
        if not _valid_point(m.get(key)):
            return False
    if not all(v >= 0.001 for v in m['radius']):
        return False
    adj = m.get('adjustments')
    if not isinstance(adj, dict):
        return False
    for key, bounds in MASK_ADJ_RANGES.items():
        if not _in(adj.get(key), bounds):
            return False
    strokes = m.get('strokes')
    if not isinstance(strokes, list) or len(strokes) > MASK_LIMITS['strokes']:
        return False
    total = 0
    for s in strokes:
        if not isinstance(s, dict):
            return False
        if not isinstance(s.get('erase'), bool):
            return False
        if not _in(s.get('radius'), (0.001, 0.5)) or not _in(s.get('feather'), (0.0, 1.0)):
            return False
        pts = s.get('points')
        if not isinstance(pts, list) or not (0 < len(pts) <= MASK_LIMITS['strokePoints']):
            return False
        if not all(_valid_point(pt) for pt in pts):
            return False
        total += len(pts)
    return total <= MASK_LIMITS['points']


def _validate_masks(p):
    if not isinstance(p, dict):
        return 'masks 参数无效'
    layers = p.get('layers')
    if not isinstance(layers, list) or len(layers) > MASK_LIMITS['layers']:
        return 'masks.layers 无效'
    if not all(_valid_mask(m) for m in layers):
        return 'masks 图层无效'
    ids = [m['id'] for m in layers]
    if len(set(ids)) != len(ids):
        return 'masks 图层 id 重复'
    return None


def _validate_step(step, version):
    if not isinstance(step, dict):
        return '步骤格式错误'
    stype = step.get('type')
    if not isinstance(stype, str):
        return '步骤缺少类型'
    params = step.get('params')
    if not isinstance(params, dict):
        params = {}

    if stype in CONTROL_KEYS:
        if version < 2 and stype not in LEGACY_KEYS:
            return '版本 %d 不支持的操作：%s' % (version, stype)
        if 'value' not in params:
            return '步骤 %s 缺少 value' % stype
        bounds = (-100.0, 100.0) if version == 1 else CONTROL_RANGES[stype]
        if not _in(params['value'], bounds):
            return '步骤 %s 的数值无效或超出范围' % stype
    elif stype == 'crop':
        if params.get('unit') != 'normalized':
            return 'crop 需要 normalized 单位'
        vals = [params.get('x'), params.get('y'), params.get('width'), params.get('height')]
        if not all(_num(v) for v in vals):
            return 'crop 参数无效'
        x, y, w, h = vals
        if not (0 <= x and 0 <= y and w > 0 and h > 0 and x + w <= 1.000001 and y + h <= 1.000001):
            return 'crop 参数越界'
    elif stype == 'rotate':
        if not _in(params.get('angle'), (-360.0, 360.0)):
            return 'rotate 角度无效'
    elif stype == 'flip':
        if params.get('direction') not in ('h', 'v'):
            return 'flip 方向无效'
    elif stype == 'perspective':
        if version < 7 or not all(_in(params.get(k), (-60.0, 60.0)) for k in ('vertical', 'horizontal')) or not isinstance(params.get('autoCrop'), bool):
            return 'perspective 参数无效'
    elif stype == 'straighten':
        if version < 4:
            return '版本 %d 不支持拉直' % version
        if not _in(params.get('angle'), (-45.0, 45.0)) or not isinstance(params.get('autoCrop'), bool):
            return 'straighten 参数无效'
    elif stype == 'filter':
        fname = params.get('name')
        if not (fname is None or _is_choice(fname, FILTER_NAMES)):
            return 'filter 名称无效'
        if 'strength' in params and not _in(params['strength'], (0.0, 100.0)):
            return 'filter 强度无效'
    elif stype == 'detail':
        if version < 4:
            return '版本 %d 不支持细节' % version
        for key, bounds in DETAIL_RANGES.items():
            if not _in(params.get(key), bounds):
                return 'detail.%s 无效' % key
    elif stype == 'white-balance':
        if version < 3:
            return '版本 %d 不支持白平衡' % version
        gains, mode, model = params.get('gains'), params.get('mode'), params.get('model')
        if not (isinstance(gains, list) and len(gains) == 3 and all(_num(g) for g in gains)):
            return 'white-balance gains 无效'
        lo, hi = (1 / 64.0, 64.0) if (version >= 5 and model == 'relative') else (0.25, 4.0)
        if not all(lo <= g <= hi for g in gains):
            return 'white-balance gains 越界'
        if mode not in ('original', 'auto', 'sample', 'custom'):
            return 'white-balance mode 无效'
        if model is not None and not (version >= 5 and model == 'relative'):
            return 'white-balance model 无效'
    elif stype == 'hsl':
        if version < 3:
            return '版本 %d 不支持 HSL' % version
        if not _is_choice(params.get('band'), HSL_BANDS):
            return 'hsl band 无效'
        for key in ('hue', 'saturation', 'luminance'):
            if not _in(params.get(key), (-100.0, 100.0)):
                return 'hsl.%s 无效' % key
    elif stype == 'curve':
        if version < 3:
            return '版本 %d 不支持曲线' % version
        if not _is_choice(params.get('channel'), CURVE_CHANNELS):
            return 'curve 通道无效'
        if not _valid_curve(params.get('points')):
            return 'curve 控制点无效'
    elif stype == 'effects':
        if version < 6:
            return '版本 %d 不支持特技' % version
        if version < 7 and isinstance(params.get('vignette'), dict) and params['vignette'].get('profile') == 'corner' and params['vignette'].get('amount'):
            return '新版暗角需要版本 7'
        return _validate_effects(params)
    elif stype == 'masks':
        if version < 6:
            return '版本 %d 不支持蒙版' % version
        return _validate_masks(params)
    else:
        return '不支持的步骤类型：%s' % stype
    return None


def _validate_steps(steps, version):
    if not isinstance(steps, list):
        return 'steps 必须是数组'
    if len(steps) > MAX_STEPS:
        return '步骤数量超出上限'
    for step in steps:
        err = _validate_step(step, version)
        if err:
            return err
    return None


def _validate_rendering(rendering):
    if rendering is None:
        return None
    if not isinstance(rendering, dict):
        return 'rendering 必须是对象'
    legacy = rendering.get('legacyTone')
    if legacy is not None:
        if not isinstance(legacy, dict):
            return 'rendering.legacyTone 无效'
        for key in ('highlights', 'shadows'):
            if not isinstance(legacy.get(key), bool):
                return 'rendering.legacyTone.%s 无效' % key
    return None


def validate_recipe(recipe):
    """校验一份配方。返回 (normalized, error)。

    normalized = {'version': int, 'rendering': dict|None, 'steps': list}
    error 为 None 表示通过。
    """
    if not isinstance(recipe, dict):
        return None, '请求格式错误'
    version = _norm_version(recipe.get('version', 1))
    if version is None:
        return None, '暂不支持此配方版本（支持 1–7）'
    steps = recipe.get('steps', [])
    err = _validate_steps(steps, version)
    if err:
        return None, err
    rendering = recipe.get('rendering')
    err = _validate_rendering(rendering)
    if err:
        return None, err
    return {'version': version, 'rendering': rendering, 'steps': steps}, None
