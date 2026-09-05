from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="""function jarvisTurnArrowWindow(turn){
  if(!turn)return null;
  const kind=turn.kind||'TURN',deg=Math.abs(Number(turn.turnDeg)||0);
  // The white line is an explanation of the maneuver, not a fixed-distance overlay.
  // Keep/merge-like actions need no painted path; exits/forks need enough branch geometry
  // to make the split obvious; normal intersections stay compact.
  if(kind==='MERGE'||/KEEP/.test(String(turn.maneuver||'')))return null;
  if(kind==='EXIT'||kind==='DIVERGE'){
    const before=deg<18?12:16,after=deg<18?32:24;
    return{startS:Math.max(0,turn.startS-before),endS:Math.min(jarvisMotion.total,turn.endS+after),maxDistance:145,branch:true};
  }
  const sharp=deg>=70,shallow=deg<38;
  const before=sharp?14:(shallow?8:11);
  const after=sharp?18:(shallow?10:14);
  return{startS:Math.max(0,turn.startS-before),endS:Math.min(jarvisMotion.total,turn.endS+after),maxDistance:105,branch:false};
}
"""
new="""function jarvisTurnArrowWindow(turn){
  if(!turn)return null;
  const kind=turn.kind||'TURN';
  // v6.14.60: Tony road-preview tuning.
  // Every visible maneuver line is now roughly half the previous visual span and is anchored
  // around the maneuver point at a 2:1 ratio: two thirds BEFORE the maneuver, one third AFTER.
  // MERGE is intentionally painted too; the previous explicit MERGE suppression hid the
  // Hannan-road merge Tony identified during preview review.
  if(/KEEP/.test(String(turn.maneuver||'')))return null;
  const branch=(kind==='EXIT'||kind==='DIVERGE'||kind==='MERGE');
  const total=branch?26:19;
  const before=total*(2/3),after=total*(1/3);
  const anchor=Number.isFinite(Number(turn.s))?Number(turn.s):((Number(turn.startS)+Number(turn.endS))/2);
  if(!Number.isFinite(anchor))return null;
  return{startS:Math.max(0,anchor-before),endS:Math.min(jarvisMotion.total,anchor+after),maxDistance:branch?145:105,branch};
}
"""
if old not in s: raise SystemExit('old jarvisTurnArrowWindow block not found')
s=s.replace(old,new,1)
s=s.replace("'v6.14.59-ROADTEST-dev'","'v6.14.60-ROADTEST-dev'")
p.write_text(s)
idx=Path('index.html')
t=idx.read_text().replace('JARVIS Road Test v6.14.59-ROADTEST-20260905T1545JST','JARVIS Road Test v6.14.60-ROADTEST-20260905T1605JST')
idx.write_text(t)
