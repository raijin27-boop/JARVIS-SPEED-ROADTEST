from pathlib import Path
p=Path('app.js'); s=p.read_text()
old_window="""  const branch=(kind==='EXIT'||kind==='DIVERGE'||kind==='MERGE');
  // v6.14.62 safety rollback: restore the compact v6.14.60 window exactly.
  // v6.14.61's bend-span expansion could paint long/looping route sections on complex geometry.
  const total=branch?26:19;
  const before=total*(2/3),after=total*(1/3);
  const anchor=Number.isFinite(Number(turn.s))?Number(turn.s):((Number(turn.startS)+Number(turn.endS))/2);
  if(!Number.isFinite(anchor))return null;
  return{startS:Math.max(0,anchor-before),endS:Math.min(jarvisMotion.total,anchor+after),maxDistance:branch?145:105,branch};
"""
new_window="""  const branch=(kind==='EXIT'||kind==='DIVERGE'||kind==='MERGE');
  // v6.14.63 final white-line geometry: use the real bend span, but clamp it tightly around
  // the maneuver center so complex interchanges cannot swallow long/looping route sections.
  // Ratio means STRAIGHT LEG before bend : STRAIGHT LEG after bend = 2 : 1.
  // Normal turn = 12m before + clamped bend + 6m after. Branch/merge = 16m + bend + 8m.
  const center=Number(turn.s);
  if(!Number.isFinite(center))return null;
  const approach=branch?16:12,exit=approach/2;
  let bendStart=Number(turn.startS),bendEnd=Number(turn.endS);
  if(!Number.isFinite(bendStart))bendStart=center;
  if(!Number.isFinite(bendEnd))bendEnd=center;
  bendStart=Math.max(center-7,Math.min(center,bendStart));
  bendEnd=Math.min(center+10,Math.max(center,bendEnd));
  return{startS:Math.max(0,bendStart-approach),endS:Math.min(jarvisMotion.total,bendEnd+exit),maxDistance:branch?145:105,branch};
"""
old_preview="""  const events=jarvisTurnEvents();
  for(const turn of events){
    const win=jarvisTurnArrowWindow(turn);
    if(!win)continue;
    const pts=[],s0=win.startS,s1=win.endS;
"""
new_preview="""  const events=jarvisTurnEvents();
  for(let ei=0;ei<events.length;ei++){
    const turn=events[ei];
    const win=jarvisTurnArrowWindow(turn);
    if(!win)continue;
    // Keep consecutive maneuver arrows visually independent. Reserve a 6m blank gap at the
    // midpoint between neighboring maneuver centers; never let two preview arrows merge.
    let s0=win.startS,s1=win.endS;
    const prev=events[ei-1],next=events[ei+1];
    if(prev&&Number.isFinite(prev.s))s0=Math.max(s0,(prev.s+turn.s)/2+3);
    if(next&&Number.isFinite(next.s))s1=Math.min(s1,(turn.s+next.s)/2-3);
    const pts=[];
"""
if old_window not in s: raise SystemExit('v662 window block missing')
if old_preview not in s: raise SystemExit('preview loop block missing')
s=s.replace(old_window,new_window,1).replace(old_preview,new_preview,1)
s=s.replace("'v6.14.62-ROADTEST-dev'","'v6.14.63-ROADTEST-dev'")
p.write_text(s)
i=Path('index.html'); t=i.read_text()
t=t.replace('JARVIS Road Test v6.14.62-ROADTEST-20260905T1740JST','JARVIS Road Test v6.14.63-ROADTEST-20260905T1810JST')
t=t.replace('JARVIS ROAD TEST v6.14.57-ROADTEST-20260904T222603Z','JARVIS ROAD TEST v6.14.63-ROADTEST-20260905T1810JST')
t=t.replace('window.__JARVIS_ROAD_TEST_BUILD_ID="v6.14.57-ROADTEST-20260904T222603Z";','window.__JARVIS_ROAD_TEST_BUILD_ID="v6.14.63-ROADTEST-20260905T1810JST";')
i.write_text(t)
