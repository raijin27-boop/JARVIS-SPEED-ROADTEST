(()=>{
'use strict';
function install(){
  if(typeof jarvisMotionAcceptFix!=='function'||typeof jarvisMotionProject!=='function'||typeof jarvisNearestActiveRoute!=='function'||typeof requestWakeLock!=='function'||typeof releaseWakeLock!=='function'||typeof jarvisComputeRoute!=='function'){
    setTimeout(install,50);return;
  }

  const originalMotionProject=jarvisMotionProject;
  const originalMotionAcceptFix=jarvisMotionAcceptFix;
  const originalRebase=typeof jarvisRebaseMotionToCurrentRoute==='function'?jarvisRebaseMotionToCurrentRoute:null;
  const originalRecovery=typeof jarvisNewRouteRecoveryState==='function'?jarvisNewRouteRecoveryState:null;
  let projectionContext=false;

  function activeRouteCache(){
    const route=(routeCandidates[selectedRouteIndex]||routeData);
    const raw=route?.path||[];
    if(raw.length<2)return null;
    const pts=raw.map(jarvisNormalizePathPoint).filter(Boolean);
    if(pts.length<2)return null;
    const cum=[0];
    for(let i=1;i<pts.length;i++)cum[i]=cum[i-1]+haversine({latitude:pts[i-1].lat,longitude:pts[i-1].lng},{latitude:pts[i].lat,longitude:pts[i].lng});
    return {pts,cum,total:cum[cum.length-1]};
  }

  function corridorProject(lat,lon){
    const rc=activeRouteCache();
    if(!rc)return null;
    const {pts,cum,total}=rc;
    const R=6371000,rad=Math.PI/180,lat0=Number(lat)*rad,cos=Math.max(.15,Math.cos(lat0));
    const center=Number.isFinite(jarvisMotion?.targetS)?jarvisMotion.targetS:null;
    const speedMps=Math.max(0,(Number(currentSpeedKmh)||0)/3.6);
    const back=center===null?0:Math.max(55,speedMps*3+30);
    const forward=center===null?Math.min(total,650):Math.max(260,speedMps*12+180);
    const lo=center===null?0:Math.max(0,center-back);
    const hi=center===null?Math.min(total,650):Math.min(total,center+forward);
    const travel=(typeof jarvisTravelHeading==='function')?jarvisTravelHeading():null;
    let best=null,bestScore=Infinity;

    for(let i=1;i<pts.length;i++){
      const segStart=cum[i-1],segEnd=cum[i];
      if(segEnd<lo||segStart>hi)continue;
      const a=pts[i-1],b=pts[i];
      const ax=(a.lng-lon)*rad*cos*R,ay=(a.lat-lat)*rad*R;
      const bx=(b.lng-lon)*rad*cos*R,by=(b.lat-lat)*rad*R;
      const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
      let u=den>0?-(ax*dx+ay*dy)/den:0;u=Math.max(0,Math.min(1,u));
      const x=ax+u*dx,y=ay+u*dy,d=Math.hypot(x,y);
      const segLen=Math.max(.01,segEnd-segStart),s=segStart+segLen*u;
      if(s<lo||s>hi)continue;
      let headingPenalty=0;
      if(Number.isFinite(travel)&&Number(currentSpeedKmh)>=5){
        const sh=bearing(a.lat,a.lng,b.lat,b.lng);
        const mm=jarvisHeadingMismatch(travel,sh);
        headingPenalty=mm>120?80:mm>90?35:mm>60?12:0;
      }
      const backwardPenalty=center!==null&&s<center-8?(center-8-s)*.45:0;
      const score=d+headingPenalty+backwardPenalty;
      if(score<bestScore){
        bestScore=score;
        best={lat:lat+y/R/rad,lng:lon+x/R/rad/cos,distance:d,s,segmentIndex:i-1,u};
      }
    }
    if(best&&jarvisMotionDiag){
      jarvisMotionDiag.candidateS=best.s;
      jarvisMotionDiag.projectionDistance=best.distance<=120?best.distance:null;
      jarvisMotionDiag.v652Corridor={lo,hi,center};
    }
    return best&&best.distance<=120?best:null;
  }

  jarvisMotionProject=function(lat,lon){
    if(projectionContext){
      const p=corridorProject(Number(lat),Number(lon));
      if(p)return p;
    }
    return originalMotionProject.apply(this,arguments);
  };

  jarvisMotionAcceptFix=function(){
    projectionContext=true;
    try{return originalMotionAcceptFix.apply(this,arguments);}
    finally{projectionContext=false;}
  };
  if(originalRebase)jarvisRebaseMotionToCurrentRoute=function(){projectionContext=true;try{return originalRebase.apply(this,arguments);}finally{projectionContext=false;}};
  if(originalRecovery)jarvisNewRouteRecoveryState=function(){projectionContext=true;try{return originalRecovery.apply(this,arguments);}finally{projectionContext=false;}};

  // Reroute/off-route matching is always a live-vehicle lookup, so use the same progress corridor.
  jarvisNearestActiveRoute=function(lat,lon){
    const p=corridorProject(Number(lat),Number(lon));
    if(!p)return null;
    const h=jarvisMotionHeadingAtS(p.s);
    return {distance:p.distance,heading:h,s:p.s,point:{lat:p.lat,lng:p.lng}};
  };

  // Route generations use different distance-along-route coordinate systems. Reset telemetry baseline
  // when a replacement route is accepted so a new route's s=0 is never treated as physical backward travel.
  window.__jarvisRouteGeneration=window.__jarvisRouteGeneration||1;
  const originalComputeRoute=jarvisComputeRoute;
  jarvisComputeRoute=async function(){
    const before=routeLastAt;
    const out=await originalComputeRoute.apply(this,arguments);
    if(routeLastAt&&routeLastAt!==before){
      window.__jarvisRouteGeneration++;
      try{jarvisRoadTestLastProjectionS=null;}catch(e){}
      try{jarvisRoadTestMarker('ROUTE_GENERATION_CHANGED',{generation:window.__jarvisRouteGeneration,routeRequestSeq});}catch(e){}
    }
    return out;
  };

  // Screen Wake Lock is mandatory during a navigation session. The base build and v6.14.49 wrapper
  // already reacquire on lifecycle events; v6.14.52 adds an independent sentinel health watchdog and
  // immediate acquisition at START so a stale/released sentinel cannot survive until auto-lock dimming.
  const originalStartNavigation=jarvisStartNavigation;
  jarvisStartNavigation=function(){
    const out=originalStartNavigation.apply(this,arguments);
    if(navSessionStarted||running){
      Promise.resolve(requestWakeLock()).catch(()=>{});
      try{jarvisRoadTestMarker('WAKE_LOCK_START_ENFORCE',{released:wakeLock?.released??null});}catch(e){}
    }
    return out;
  };

  let wakeHealthBusy=false;
  async function enforceWake(reason){
    if(wakeHealthBusy||document.visibilityState!=='visible'||!(navSessionStarted||running))return;
    const stale=!wakeLock||wakeLock.released===true;
    if(!stale)return;
    wakeHealthBusy=true;
    try{
      try{jarvisRoadTestMarker('WAKE_LOCK_HEALTH_REPAIR',{reason,hadSentinel:!!wakeLock,released:wakeLock?.released??null});}catch(e){}
      if(wakeLock?.released===true)wakeLock=null;
      await requestWakeLock();
    }finally{wakeHealthBusy=false;}
  }
  setInterval(()=>{enforceWake('heartbeat');},1000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')enforceWake('visibility');});
  window.addEventListener('pageshow',()=>enforceWake('pageshow'));
  window.addEventListener('focus',()=>enforceWake('focus'));
  document.addEventListener('pointerdown',()=>{if(navSessionStarted||running)enforceWake('user-activity');},{passive:true});

  try{jarvisRoadTestMarker('V652_PATCH_READY',{generation:window.__jarvisRouteGeneration});}catch(e){}
}
install();
})();
