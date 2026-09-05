from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="""  // v6.14.70 ROUTE LOCK: while navigation state is TRACKING, the rider-facing position
  // belongs to the selected route. Raw GPS remains independent for off-route evidence/rerouting.
  // Do not release the marker merely because GPS heading temporarily disagrees at a bend.
  // v6.14.71 SUPER LOCK: TRACKING display always projects to the selected route when a
  // projection exists. Distance does NOT weaken the visible adhesion; raw GPS remains available
  // to the independent reroute detector and wins only after OFF_ROUTE/REROUTING is confirmed.
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  return{lat:rp.lat,lng:rp.lng};
"""
new="""  // v6.14.72 SMOOTH ADHESION: keep a strong route bias, but do NOT teleport the display
  // directly onto each new 1 Hz GPS projection. The free-motion renderer below interpolates
  // continuously toward this target, eliminating the repeated rabbit-hop caused by v70/v71.
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  let strength=pr.distance<=70?1:pr.distance<=100?.985:.95;
  if(acc>35)strength=Math.min(strength,.94);
  return{lat:lat+(rp.lat-lat)*strength,lng:lng+(rp.lng-lng)*strength};
"""
if old not in s: raise SystemExit('v71 super-lock block missing')
s=s.replace(old,new,1)
old2="""  // v6.14.70: smoothing may lag behind the route target; finish each TRACKING frame exactly
  // on the selected polyline. OFF_ROUTE/REROUTING bypass this and keep real GPS authority.
  if(hardRouteLock&&Number.isFinite(d?.lat)&&Number.isFinite(d?.lng)){
    jarvisFreeMotion.displayLat=d.lat;jarvisFreeMotion.displayLon=d.lng;
  }
"""
new2="""  // v6.14.72: never overwrite the interpolated display position with the newest route target.
  // The marker stays strongly route-biased but moves there continuously frame-by-frame.
"""
if old2 not in s: raise SystemExit('v70 hard final snap missing')
s=s.replace(old2,new2,1)
s=s.replace("'v6.14.71-ROADTEST-dev'","'v6.14.72-ROADTEST-dev'",1)
p.write_text(s)

idx=Path('index.html')
t=idx.read_text()
t=t.replace('v6.14.71-ROADTEST-20260906T0112JST','v6.14.72-ROADTEST-20260906T0118JST')
t=t.replace('v6.14.66-ROADTEST-20260905T2345JST','v6.14.72-ROADTEST-20260906T0118JST')
t=t.replace('<script src="app.js" defer></script>','<script src="app.js?v=v6.14.72-0118" defer></script>',1)
t=t.replace('<script src="road-test-ui.js" defer></script>','<script src="road-test-ui.js?v=v6.14.72-0118" defer></script>',1)
idx.write_text(t)
