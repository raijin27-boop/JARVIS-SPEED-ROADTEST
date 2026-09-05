from pathlib import Path
p=Path('app.js'); s=p.read_text()
old="""function jarvisRenderPreviewTurnArrows(){
  jarvisClearPreviewTurnArrows();
  if(!navGoogleMap||navMode!=='ROUTE'||navSessionStarted||!routePreviewActive||!routeData)return;
  if(!jarvisMotionPreparePath())return;
  const events=jarvisTurnEvents();
"""
new="""function jarvisPreviewManeuverEvents(){
  const base=jarvisTurnEvents();
  const out=base.slice(),seen=new Set(base.map(e=>e.stepIndex));
  const steps=jarvisVoiceSteps();
  for(let i=0;i<steps.length;i++){
    if(seen.has(i))continue;
    const st=steps[i],strength=jarvisTurnStrength(st);
    if(!['HARD','SLIGHT','EXIT','DIVERGE','MERGE'].includes(strength))continue;
    const pt=jarvisVoiceManeuverPoint(st);if(!pt)continue;
    const pr=jarvisMotionProject(pt.latitude,pt.longitude);if(!pr)continue;
    const kind=jarvisGuidanceKind(strength),m=jarvisTurnManeuver(st);
    const dir=jarvisTurnDir(st)||jarvisManeuverDir(m)||jarvisInstructionDir(st)||null;
    out.push({stepIndex:i,s:pr.s,startS:Math.max(0,pr.s-3),endS:Math.min(jarvisMotion.total,pr.s+5),turnDeg:0,dir,key:`${i}:${kind}:PREVIEW_RESCUE`,source:'PREVIEW_RESCUE',maneuver:m,kind});
  }
  return out.sort((a,b)=>a.s-b.s);
}
function jarvisRenderPreviewTurnArrows(){
  jarvisClearPreviewTurnArrows();
  if(!navGoogleMap||navMode!=='ROUTE'||(!routePreviewActive&&!navSessionStarted)||!routeData)return;
  if(!jarvisMotionPreparePath())return;
  const events=jarvisPreviewManeuverEvents();
"""
if old not in s: raise SystemExit('preview anchor missing')
s=s.replace(old,new,1).replace("'v6.14.63-ROADTEST-dev'","'v6.14.64-ROADTEST-dev'")
p.write_text(s)
i=Path('index.html'); t=i.read_text()
t=t.replace('JARVIS Road Test v6.14.63-ROADTEST-20260905T1810JST','JARVIS Road Test v6.14.64-ROADTEST-20260905T1854JST')
t=t.replace('JARVIS ROAD TEST v6.14.63-ROADTEST-20260905T1810JST','JARVIS ROAD TEST v6.14.64-ROADTEST-20260905T1854JST')
t=t.replace('window.__JARVIS_ROAD_TEST_BUILD_ID="v6.14.63-ROADTEST-20260905T1810JST";','window.__JARVIS_ROAD_TEST_BUILD_ID="v6.14.64-ROADTEST-20260905T1854JST";')
i.write_text(t)
