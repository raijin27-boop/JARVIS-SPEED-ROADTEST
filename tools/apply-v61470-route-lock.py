from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="""  const routeH=jarvisMotionHeadingAtS(pr.s),travel=jarvisTravelHeading();
  const mismatch=Number.isFinite(travel)?jarvisHeadingMismatch(travel,routeH):0;
  if(Number(currentSpeedKmh)>=8&&mismatch>72)return{lat,lng};
  const maxSnap=Math.max(68,Math.min(92,64+acc*1.35));
  if(pr.distance>maxSnap)return{lat,lng};
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  // v6.14.66: consumer-nav hard adhesion. While TRACKING the cursor is ON the route.
  let strength=pr.distance<=45?1:pr.distance<=65?.985:.94;
  if(acc>35)strength=Math.min(strength,.92);
  return{lat:lat+(rp.lat-lat)*strength,lng:lng+(rp.lng-lng)*strength};
"""
new="""  // v6.14.70 ROUTE LOCK: while navigation state is TRACKING, the rider-facing position
  // belongs to the selected route. Raw GPS remains independent for off-route evidence/rerouting.
  // Do not release the marker merely because GPS heading temporarily disagrees at a bend.
  const maxSnap=Math.max(105,Math.min(120,96+acc*1.25));
  if(pr.distance>maxSnap)return{lat,lng};
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  return{lat:rp.lat,lng:rp.lng};
"""
if old not in s: raise SystemExit('route adhesion block missing')
s=s.replace(old,new,1)
old2="""  const predictAge=isolated?.25:(escape?.65:1.35), predictCap=isolated?3:(escape?10:25);
  if(jarvisFreeMotion.speedMps>1&&Number.isFinite(jarvisFreeMotion.targetHeading)&&age<predictAge)
    d=jarvisFreeForward(d.lat,d.lng,jarvisFreeMotion.targetHeading,Math.min(predictCap,jarvisFreeMotion.speedMps*age));
"""
new2="""  const predictAge=isolated?.25:(escape?.65:1.35), predictCap=isolated?3:(escape?10:25);
  const hardRouteLock=!!(navSessionStarted&&navMode==='ROUTE'&&jarvisNavTrackingState==='TRACKING'&&!jarvisDeviationEscape&&!jarvisVisualGpsPriority);
  // Never push the displayed marker forward from GPS heading while hard-locked to the route.
  if(!hardRouteLock&&jarvisFreeMotion.speedMps>1&&Number.isFinite(jarvisFreeMotion.targetHeading)&&age<predictAge)
    d=jarvisFreeForward(d.lat,d.lng,jarvisFreeMotion.targetHeading,Math.min(predictCap,jarvisFreeMotion.speedMps*age));
"""
if old2 not in s: raise SystemExit('prediction block missing')
s=s.replace(old2,new2,1)
old3="""  }
  const mh=headingUpMode&&Number.isFinite(jarvisFreeMotion.displayHeading)?jarvisFreeMotion.displayHeading:0;
"""
new3="""  }
  // v6.14.70: smoothing may lag behind the route target; finish each TRACKING frame exactly
  // on the selected polyline. OFF_ROUTE/REROUTING bypass this and keep real GPS authority.
  if(hardRouteLock&&Number.isFinite(d?.lat)&&Number.isFinite(d?.lng)){
    jarvisFreeMotion.displayLat=d.lat;jarvisFreeMotion.displayLon=d.lng;
  }
  const mh=headingUpMode&&Number.isFinite(jarvisFreeMotion.displayHeading)?jarvisFreeMotion.displayHeading:0;
"""
if old3 not in s: raise SystemExit('display finalize anchor missing')
s=s.replace(old3,new3,1)
s=s.replace("'v6.14.67-ROADTEST-dev'","'v6.14.70-ROADTEST-dev'",1)
p.write_text(s)
i=Path('index.html')
t=i.read_text().replace('v6.14.67-ROADTEST-20260906T0055JST','v6.14.70-ROADTEST-20260906T0105JST',1)
i.write_text(t)
