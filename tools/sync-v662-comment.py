from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="  // v6.14.62 safety rollback: restore the compact v6.14.60 window exactly.\n  const total=branch?26:19;"
new="  // v6.14.62 safety rollback: restore the compact v6.14.60 window exactly.\n  // v6.14.61's bend-span expansion could paint long/looping route sections on complex geometry.\n  const total=branch?26:19;"
if old not in s: raise SystemExit('sync anchor missing')
p.write_text(s.replace(old,new,1))
