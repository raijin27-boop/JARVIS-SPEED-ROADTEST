from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="let routeRequestSeq=0, routeLastOrigin=null, routeLastAt=0;"
new="let routeRequestSeq=0, routeLastOrigin=null, routeLastAt=0;\nlet jarvisStartGuardAt=0,jarvisStartMovingFixes=0; // v6.14.71 START LOCK"
if old not in s: raise SystemExit('start guard anchor missing')
s=s.replace(old,new,1)
old2="""  const maxSnap=Math.max(105,Math.min(120,96+acc*1.25));
  if(pr.distance>maxSnap)return{lat,lng};
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  return{lat:rp.lat,lng:rp.lng};
"""
new2="""  // v6.14.71 SUPER LOCK: TRACKING display always projects to the selected route when a
  // projection exists. Distance does NOT weaken the visible adhesion; raw GPS remains available
  // to the independent reroute detector and wins only after OFF_ROUTE/REROUTING is confirmed.
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  return{lat:rp.lat,lng:rp.lng};
"""
if old2 not in s: raise SystemExit('v70 snap block missing')
s=s.replace(old2,new2,1)
old3="""function jarvisAutoRerouteUpdate(coords,speedKmh){
  if(!navSessionStarted||navMode!=='ROUTE'||!routeData){
    jarvisNavTrackingState='TRACKING';
    jarvisResetAutoRerouteWatch();return;
  }
"""
new3="""function jarvisAutoRerouteUpdate(coords,speedKmh){
  if(!navSessionStarted||navMode!=='ROUTE'||!routeData){
    jarvisStartGuardAt=0;jarvisStartMovingFixes=0;
    jarvisNavTrackingState='TRACKING';
    jarvisResetAutoRerouteWatch();return;
  }
  // v6.14.71 START LOCK: never call a stationary START an off-route event. The first route
  // owns the display while the rider is stopped/creeping and while GPS heading is unavailable.
  // Reroute evidence is enabled only after both a short settle time and consecutive real motion.
  if(!jarvisStartGuardAt)jarvisStartGuardAt=Date.now();
  const startAcc=Number(coords?.accuracy);
  const startSpeed=Math.max(0,Number(speedKmh)||0);
  if(startSpeed>=6 && (!Number.isFinite(startAcc)||startAcc<=35))jarvisStartMovingFixes++;
  else if(startSpeed<3)jarvisStartMovingFixes=0;
  const startGuard=(Date.now()-jarvisStartGuardAt<6000)||(jarvisStartMovingFixes<4);
  if(startGuard){
    jarvisNavTrackingState='TRACKING';
    jarvisDeviationEscape=false;jarvisVisualGpsPriority=false;jarvisDeviationEvidence=0;
    jarvisResetAutoRerouteWatch();return;
  }
"""
if old3 not in s: raise SystemExit('auto reroute function anchor missing')
s=s.replace(old3,new3,1)
s=s.replace("'v6.14.70-ROADTEST-dev'","'v6.14.71-ROADTEST-dev'",1)
p.write_text(s)
i=Path('index.html')
t=i.read_text().replace('v6.14.70-ROADTEST-20260906T0105JST','v6.14.71-ROADTEST-20260906T0112JST',1)
i.write_text(t)
