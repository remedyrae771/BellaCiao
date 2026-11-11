"""Собирает приложение в один HTML-файл для публикации на claude.ai.
Использование: python3 tools/build-artifact.py <путь к результату>"""
import sys
css = open('css/styles.css').read()
js = ''.join(open(f).read() + '\n' for f in ['js/data.js', 'js/ttk-data.js', 'js/sync.js', 'js/app.js'])
assert '</script' not in js
open(sys.argv[1], 'w').write(f'''<title>Bella Ciao Кухня</title>
<meta name="theme-color" content="#13284a">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Pacifico&display=swap">
<style>
:root {{ color-scheme: light; }}
{css}
body::before {{ content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--navy); }}
</style>
<div id="app"></div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
{js}
</script>
''')
