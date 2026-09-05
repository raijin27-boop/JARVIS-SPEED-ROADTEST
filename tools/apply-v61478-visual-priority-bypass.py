from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="""function jarvisTrackingDisplayTargetV665(lat,lng){
  if(!navSessionStarted||navMode!=='ROUTE'||jarvisDeviationEscape||jarvisNavTrackingState==='OFF_ROUTE'||jarvisNavTrackingState==='REROUTING')return{lat,lng};
"""
new="""function jarvisTrackingDisplayTargetV665(lat,lng){
  // v6.14.78 VISUAL PRIORITY BYPASS: once visual GPS ownership is granted, do not feed
  // a route-projected target back into freeMotion. v76/v77 released the renderer, but this
  // helper still transformed the underlying target onto the stale route, so the ball remained
  // visibly pulled toward it until deviationEscape/OFF_ROUTE. GPS visual ownership must mean
  // raw accepted GPS target ownership end-to-end.
  if(!navSessionStarted||navMode!=='ROUTE'||jarvisVisualGpsPriority||jarvisDeviationEscape||jarvisNavTrackingState==='OFF_ROUTE'||jarvisNavTrackingState==='REROUTING')return{lat,lng};
"""
if old not in s: raise SystemExit('tracking display target header missing')
s=s.replace(old,new,1)
s=s.replace("'v6.14.77-ROADTEST-dev'","'v6.14.78-ROADTEST-dev'",1)
p.write_text(s)
idx=Path('index.html')
t=idx.read_text().replace('v6.14.77-ROADTEST-20260906T0315JST','v6.14.78-ROADTEST-20260906T0325JST').replace('app.js?v=v6.14.77-0315','app.js?v=v6.14.78-0325').replace('road-test-ui.js?v=v6.14.77-0315','road-test-ui.js?v=v6.14.78-0325')
idx.write_text(t)
