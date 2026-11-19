"""Разбор выгрузки ТТК из учётной системы (файлы .xls) в JSON.

Использование:  pip install xlrd==2.0.1 --target <папка>
                python3 tools/parse-ttk-xls.py <папка с xlrd> <папка с .xls> <результат.json>

Категория и станция определяются по первой карте каждого файла (словарь FILES ниже)."""
import sys, os, re, json
sys.path.insert(0, sys.argv[1])
import xlrd

# Файл → (категория, станция). Файлы определяются по первой карте.
FILES = {
    'ЗЕЛЕНЫЙ САЛАТ С КУРИЦЕЙ': ('Салаты', 'cold'),
    'ПИЦЦА ГРУША ГОРГОНЗОЛА': ('Пицца', 'pizza'),
    'ПФ Бига кг': ('Тесто и хлеб', ''),
    'ВИТРИНА БАГЕТ ШТ': ('Тесто и хлеб', ''),
    'ПФ Соус Бешамель кг': ('Соусы и заправки', ''),
    'ГРИБНОЙ КРЕМ-СУП': ('Супы и бульоны', ''),
    'ПФ Артишок Консервированный  нетто кг': ('Полуфабрикаты', ''),
    'АНЬОЛОТИ С КУРИЦЕЙ': ('Паста и равиоли', 'pasta'),
    'ПФ Вишня с Сахаре кг': ('Десерты', 'pastry'),
    'ГОВЯЖЬИ ЩЕКИ': ('Горячие блюда', 'grill'),
    'ПФ Баклажан Запеченный кг': ('Полуфабрикаты', ''),
    'АНТИПАСТИ-МИКС NEW': ('Закуски и антипасти', 'cold'),
    'ДМ КУРИНЫЕ КОТЛЕТЫ С ПЮРЕ': ('Детское меню', ''),
    'ПФ Каноли с Апельсиновой цедрой 60г шт': ('Полуфабрикаты', ''),
    'ЛИНГВИНИ С КРЕВЕТКАМИ': ('Паста и равиоли', 'pasta'),
    'ПФ Вонголе Дефрост кг': ('Рыба и морепродукты', ''),
}
UNITS = {'кг': 'кг', 'л': 'л', 'шт': 'шт', 'порц': 'порц', 'пор': 'порц'}

def isnum(v):
    if isinstance(v, float): return True
    return bool(re.fullmatch(r'\s*\d+([.,]\d+)?\s*', str(v)))
def tonum(v):
    return float(str(v).replace(',', '.')) if not isinstance(v, float) else v

def split_unit(name):
    m = re.match(r'^(.*?)\s+(кг|л|шт|порц|пор)\.?\s*$', name.strip())
    return (m.group(1).strip(), UNITS[m.group(2)]) if m else (name.strip(), '')

def clean_ing(name):
    name = re.sub(r'\s+', ' ', name).strip()
    name = re.sub(r'^О (?=[А-ЯЁ])', '', name)          # учётная пометка «О Вода»
    name = re.sub(r'^Пф ', 'ПФ ', name)
    return name[:1].upper() + name[1:]

def nice_title(t):
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'^Пф ', 'ПФ ', t)
    base, unit = split_unit(t)
    if base.isupper() or base == base.upper():
        words = base.lower().split(' ')
        base = ' '.join(words)
        base = base[:1].upper() + base[1:]
        base = re.sub(r'^дм (\w)', lambda m: 'ДМ ' + m.group(1).upper(), base, flags=re.I)
        base = re.sub(r'\bnew\b', '(new)', base, flags=re.I)
        base = re.sub(r'(\d+) г\b', r'\1 г', base)
    else:
        base = re.sub(r'\bnew\b', '(new)', base)
    return base

def nice_yield(s, unit_from_title):
    s = str(s).strip()
    m = re.match(r'([\d.,]+)\s*(\S+)', s)
    if not m: return s
    q, u = float(m.group(1).replace(',', '.')), m.group(2).rstrip('.')
    if u.startswith('пор'): return '1 порция' if q == 1 else (f'{q:g}'.replace('.', ',') + ' порц.')
    if u == 'шт': return f'{q:g} шт'.replace('.', ',')
    return f'{q:.3f} {u}'.replace('.', ',')

SENT = re.compile(r'(?<=[.!?])\s+(?=[А-ЯЁA-Z0-9«"])')
def split_steps(text):
    text = re.sub(r'[ \t]+', ' ', text.replace('\r', '\n')).strip()
    parts = []
    for para in [p.strip() for p in text.split('\n') if p.strip()]:
        # нумерованные шаги «1. … 2. …»
        if re.search(r'(^|\s)\d\.\s*[А-ЯЁA-Z]', para) and len(re.findall(r'(?:^|\s)\d\.\s', para)) >= 2:
            parts += [x.strip() for x in re.split(r'(?:^|\s)(?=\d\.\s*[А-ЯЁA-Z])', para) if x.strip()]
        else:
            parts += [x.strip() for x in SENT.split(para) if x.strip()]
    out = []
    for p in parts:
        p = p[:1].upper() + p[1:] if p else p
        if out and len(p) < 25 and not re.match(r'^\d', p): out[-1] += ' ' + p   # слишком короткие хвосты — к предыдущему шагу
        else: out.append(p)
    return out

def parse_file(path):
    sh = xlrd.open_workbook(path).sheet_by_index(0)
    rows = [[sh.cell_value(r, c) for c in range(sh.ncols)] for r in range(sh.nrows)]
    nz = [i for i, r in enumerate(rows) if any(str(x).strip() for x in r)]
    cards, cur, mode = [], None, None
    for k, i in enumerate(nz):
        r = rows[i]; c0 = str(r[0]).strip(); c10 = r[10] if len(r) > 10 else ''
        nxt = rows[nz[k + 1]] if k + 1 < len(nz) else None
        is_title = c0 and not str(c10).strip() and nxt is not None and (
            (str(nxt[10]).strip() and isnum(nxt[10])) or str(nxt[4]).strip() == 'ИТОГО')
        if is_title:
            cur = {'raw': c0, 'ings': [], 'yield': '', 'total': None, 'tech': '', 'serve': ''}
            cards.append(cur); mode = 'ing'; continue
        if cur is None: continue
        if str(r[4]).strip() == 'ИТОГО':
            cur['yield'] = str(r[6]).strip(); cur['total'] = tonum(r[9]) if isnum(r[9]) else None; mode = 'after'; continue
        if mode == 'ing' and c0 and str(c10).strip() and isnum(c10):
            cur['ings'].append((c0, tonum(c10))); continue
        if c0 == 'Технология приготовления': mode = 'tech'; continue
        if mode == 'tech' and c0:
            cur['tech'] += ('\n' if cur['tech'] else '') + c0
    return cards

def build(card, cat, st, idx):
    title, tunit = split_unit(re.sub(r'\s+', ' ', card['raw']).strip())
    kind = 'pf' if re.match(r'^пф\b', card['raw'].strip(), re.I) else 'dish'
    ings = []
    for name, q in card['ings']:
        n, u = split_unit(name)
        ings.append([clean_ing(n), round(q, 4), u or 'кг'])
    text = card['tech']
    serve = ''
    m = re.split(r'ТРЕБОВАНИЯ К ОФОРМЛЕНИЮ,? ПОДАЧЕ И РЕАЛИЗАЦИИ:?', text)
    tech_txt = m[0].strip(); serve = ' '.join(x.strip() for x in m[1:]).strip()
    steps = split_steps(tech_txt) if tech_txt else []
    storage = [s for s in steps if re.match(r'^(хран|срок хранения)', s, re.I)]
    steps = [s for s in steps if s not in storage]
    rec = {
        'id': 'x%03d' % idx, 'kind': kind, 'category': cat, 'station': st,
        'name': nice_title(card['raw']), 'yield': nice_yield(card['yield'], tunit), 'ingredients': ings,
    }
    if steps: rec['tech'] = steps
    if storage: rec['storage'] = ' '.join(storage)
    if serve: rec['serve'] = serve
    # сверка суммы ингредиентов (кг + л) с «ИТОГО» брутто из системы
    s = sum(q for _, q, u in ings if u in ('кг', 'л'))
    rec['_sum'] = round(s, 4); rec['_total'] = card['total']
    return rec

out, idx = [], 0
for f in sorted(os.listdir(sys.argv[2])):
    cards = parse_file(os.path.join(sys.argv[2], f))
    if not cards: continue
    cat, st = FILES.get(cards[0]['raw'], ('Полуфабрикаты', ''))
    for c in cards:
        idx += 1; out.append(build(c, cat, st, idx))
json.dump(out, open(sys.argv[3], 'w'), ensure_ascii=False, indent=1)
mism = [r for r in out if r['_total'] is not None and abs(r['_sum'] - r['_total']) > 0.0015]
print('карт:', len(out), '| блюд:', sum(r['kind'] == 'dish' for r in out), '| ПФ:', sum(r['kind'] == 'pf' for r in out))
print('без технологии:', sum('tech' not in r for r in out), '| с хранением:', sum('storage' in r for r in out), '| с подачей:', sum('serve' in r for r in out))
print('сумма ≠ ИТОГО:', len(mism))
for r in mism[:40]: print('  ', r['name'], '| сумма', r['_sum'], '| итого', r['_total'], '| есть шт:', any(u == 'шт' for _, _, u in r['ingredients']))
