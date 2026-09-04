(()=>{
'use strict';
function install(){
  if(typeof jarvisStartNavigation!=='function'||typeof jarvisAutoRerouteUpdate!=='function'||typeof jarvisComputeRoute!=='function'||typeof jarvisMotionProject!=='function'||typeof jarvisRenderRoute!=='function'||typeof requestWakeLock!=='function'){
    setTimeout(install,50);return;
  }

  let originalRouteSnapshot=null;
  let originalRouteRestoreFixes=0;
  let fastOffRouteFixes=0;
  let fastOffRouteSince=0;
  let fastRerouteBusy=false;

  function cloneRouteSnapshot(route){
    if(!route?.path?.length)return null;
    return {
      route,
      path:route.path.map(jarvisNormalizePathPoint).filter(Boolean)
    };
  }

  function projectOnPath(path,lat,lon){
    if(!Array.isArray(path)||path.length<2)return null;
    const R=6371000,rad=Math.PI/180,lat0=lat*rad,cos=Math.max(.15,Math.cos(lat0));
    let best=null,bestD=Infinity,cum=0;
    const travel=typeof jarvisTravelHeading==='function'?jarvisTravelHeading():null;
    for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i];
      const segLen=haversine({latitude:a.lat,longitude:a.lng},{latitude:b.lat,longitude:b.lng});
      const ax=(a.lng-lon)*rad*cos*R,ay=(a.lat-lat)*rad*R;
      const bx=(b.lng-lon)*rad*cos*R,by=(b.lat-lat)*rad*R;
      const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
      let u=den>0?-(ax*dx+ay*dy)/den:0;u=Math.max(0,Math.min(1,u));
      const x=ax+u*dx,y=ay+u*dy,d=Math.hypot(x,y);
      const s=cum+segLen*u;
      const heading=bearing(a.lat,a.lng,b.lat,b.lng);
      const mismatch=Number.isFinite(travel)?jarvisHeadingMismatch(travel,heading):0;
      const score=d+(Number(currentSpeedKmh)>=5&&mismatch>70?20:0);
      if(score<bestD){bestD=score;best={distance:d,s,heading,mismatch,point:{lat:lat+y/R/rad,lng:lon+x/R/rad/cos}};}
      cum+=segLen;
    }
    return best;
  }

  function clearRouteVisualArtifacts(){
    try{
      const keep=navRouteLine;
      for(const line of (navAltRouteLines||[]).slice()){
        if(line===keep)continue;
        try{line?.setMap?.(null)}catch(e){}
        try{line?.remove?.()}catch(e){}
      }
      navAltRouteLines=keep?[keep]:[];
      try{landRouteLine?.setMap?.(null)}catch(e){}
      landRouteLine=null;
      jarvisClearRouteLabels?.();
      jarvisClearTurnArrow?.();
    }catch(e){}
  }

  const previousStart=jarvisStartNavigation;
  jarvisStartNavigation=function(){
    const startingFresh=!navSessionStarted&&navMode==='ROUTE'&&routeCandidates?.length;
    if(startingFresh){
      const chosen=routeCandidates[selectedRouteIndex]||routeData;
      originalRouteSnapshot=cloneRouteSnapshot(chosen);
      originalRouteRestoreFixes=0;
      fastOffRouteFixes=0;fastOffRouteSince=0;
      try{window.__jarvisOriginalRouteSnapshotReady=!!originalRouteSnapshot;}catch(e){}
      jarvisV653KeepAwakeStart();
    }
    const out=previousStart.apply(this,arguments);
    if(navSessionStarted){
      requestWakeLock().catch?.(()=>{});
      jarvisV653KeepAwakeStart();
    }
    return out;
  };

  async function restoreOriginalRoute(reason,state){
    if(!originalRouteSnapshot?.route||!navSessionStarted)return false;
    routeRequestSeq++;
    routeCandidates=[originalRouteSnapshot.route];
    selectedRouteIndex=0;
    routeData=originalRouteSnapshot.route;
    routeLastAt=Date.now();
    routeLastOrigin={latitude:currentLat,longitude:currentLon};
    jarvisPendingRouteRejoin=false;jarvisPendingRouteRejoinFixes=0;
    jarvisExitDeviationEscape?.();
    jarvisResetAutoRerouteWatch?.();
    jarvisNavTrackingState='TRACKING';
    jarvisMotionReset?.();
    jarvisMotionAcceptFix?.(currentLat,currentLon,currentSpeedKmh,lastPos?.coords?.accuracy);
    jarvisResetVoiceProgress?.();
    clearRouteVisualArtifacts();
    jarvisRenderRoute();
    jarvisSetRouteGuidanceAppearance?.(true);
    jarvisSetStatus?.('元のルートへ復帰：リルート線を破棄しました','ok');
    try{jarvisRoadTestMarker?.('ORIGINAL_ROUTE_RESTORED',{reason,distance:state?.distance??null,mismatch:state?.mismatch??null,routeRequestSeq});}catch(e){}
    originalRouteRestoreFixes=0;
    fastOffRouteFixes=0;fastOffRouteSince=0;
    return true;
  }

  async function confirmedFastReroute(reason,near,accuracy,speedKmh){
    if(fastRerouteBusy||autoRerouteBusy||!navSessionStarted||!destination)return;
    fastRerouteBusy=true;autoRerouteBusy=true;
    autoRerouteLastAt=Date.now();
    jarvisNavTrackingState='REROUTING';
    jarvisEnterDeviationEscape?.(reason);
    jarvisResetAutoRerouteWatch?.();
    jarvisSetStatus?.('ルート逸脱を確認：即時再検索中…','warn');
    try{jarvisRoadTestMarker?.('V653_FAST_REROUTE',{reason,distance:near?.distance??null,accuracy,speedKmh});}catch(e){}
    try{await jarvisComputeRoute(true,true,'HEADING');}
    finally{autoRerouteBusy=false;fastRerouteBusy=false;fastOffRouteFixes=0;fastOffRouteSince=0;}
  }

  const previousAutoUpdate=jarvisAutoRerouteUpdate;
  jarvisAutoRerouteUpdate=function(coords,speedKmh){
    if(!navSessionStarted||navMode!=='ROUTE'||!routeData)return previousAutoUpdate.apply(this,arguments);
    const lat=Number(coords?.latitude),lon=Number(coords?.longitude),acc=Number(coords?.accuracy);
    const speed=Number(speedKmh)||0;

    // If a reroute was accepted but the rider physically rejoins the ORIGINAL selected route,
    // prefer that familiar route again and discard the temporary reroute geometry.
    if(originalRouteSnapshot?.path?.length&&Number.isFinite(lat)&&Number.isFinite(lon)){
      const os=projectOnPath(originalRouteSnapshot.path,lat,lon);
      const isCurrentlyOriginal=routeData===originalRouteSnapshot.route;
      const originalAligned=!!os&&os.distance<=Math.max(7,Math.min(11,(Number.isFinite(acc)?acc:12)*.55))&&(speed<5||os.mismatch<38);
      if(!isCurrentlyOriginal&&originalAligned)originalRouteRestoreFixes++; else originalRouteRestoreFixes=0;
      if(originalRouteRestoreFixes>=3){restoreOriginalRoute('physical-rejoin',os);return;}
    }

    const near=(Number.isFinite(lat)&&Number.isFinite(lon))?jarvisNearestActiveRoute(lat,lon):null;
    if(near&&Number.isFinite(acc)&&acc<=40&&speed>=3){
      const moveHeading=Number.isFinite(currentHeading)?currentHeading:jarvisLastMovingHeading;
      const mismatch=jarvisHeadingMismatch(moveHeading,near.heading);
      const lateral=near.distance;
      // Accuracy-adaptive corridor: good GPS reroutes around 12-14m; weaker GPS gets up to 20m.
      const threshold=Math.max(12,Math.min(20,7+acc*.65));
      const headingDeparture=speed>=6&&lateral>5&&mismatch>60;
      const clearlyFar=lateral>threshold;
      const hardFar=lateral>Math.max(24,threshold+7);
      const evidence=clearlyFar||headingDeparture;
      if(evidence){
        if(!fastOffRouteSince)fastOffRouteSince=Date.now();
        fastOffRouteFixes++;
        const held=Date.now()-fastOffRouteSince;
        jarvisNavTrackingState='OFF_ROUTE';
        const ready=(hardFar&&fastOffRouteFixes>=2)||(fastOffRouteFixes>=2&&held>=550);
        if(ready&&Date.now()-autoRerouteLastAt>=1400){
          confirmedFastReroute(headingDeparture?'HEADING':'LATERAL',near,acc,speed);
          return;
        }
      }else if(lateral<8&&(speed<5||mismatch<35)){
        fastOffRouteFixes=0;fastOffRouteSince=0;
        if(!jarvisPendingRouteRejoin){
          jarvisExitDeviationEscape?.();
          jarvisNavTrackingState='TRACKING';
          jarvisSetRouteGuidanceAppearance?.(true);
        }
      }else{
        fastOffRouteFixes=Math.max(0,fastOffRouteFixes-1);
        if(!fastOffRouteFixes)fastOffRouteSince=0;
      }
    }
    return previousAutoUpdate.apply(this,arguments);
  };

  // ----- iPhone keep-awake hardening -----
  let keepVideo=null,keepCanvas=null,keepCtx=null,keepStream=null,keepRaf=0;
  function buildKeepAwakeVideo(){
    if(keepVideo)return keepVideo;
    try{
      keepCanvas=document.createElement('canvas');keepCanvas.width=2;keepCanvas.height=2;
      keepCtx=keepCanvas.getContext('2d');
      keepVideo=document.createElement('video');
      keepVideo.muted=true;keepVideo.playsInline=true;keepVideo.setAttribute('playsinline','');keepVideo.setAttribute('webkit-playsinline','');
      keepVideo.style.cssText='position:fixed;width:2px;height:2px;left:-10px;top:-10px;opacity:.01;pointer-events:none;z-index:-1';
      document.body.appendChild(keepVideo);
      if(keepCanvas.captureStream){keepStream=keepCanvas.captureStream(1);keepVideo.srcObject=keepStream;}
    }catch(e){}
    return keepVideo;
  }
  function pulseCanvas(){
    if(!keepCtx)return;
    keepCtx.fillStyle=(Date.now()%2000<1000)?'#000':'#010101';keepCtx.fillRect(0,0,2,2);
    keepRaf=setTimeout(pulseCanvas,800);
  }
  window.jarvisV653KeepAwakeStart=function(){
    try{
      const v=buildKeepAwakeVideo();
      if(!keepRaf)pulseCanvas();
      const p=v?.play?.();if(p?.catch)p.catch(()=>{});
      if(document.visibilityState==='visible')requestWakeLock().catch?.(()=>{});
      jarvisRoadTestMarker?.('V653_KEEP_AWAKE_ENFORCE',{wake:!!wakeLock,released:wakeLock?.released??null,video:!!v});
    }catch(e){}
  };
  function enforceScreen(){
    if(document.visibilityState!=='visible'||!(navSessionStarted||running))return;
    if(!wakeLock||wakeLock.released===true)requestWakeLock().catch?.(()=>{});
    const v=buildKeepAwakeVideo();
    if(v?.paused){const p=v.play?.();if(p?.catch)p.catch(()=>{});}
  }
  setInterval(enforceScreen,500);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(enforceScreen,30);});
  window.addEventListener('pageshow',()=>setTimeout(enforceScreen,30));
  window.addEventListener('focus',()=>setTimeout(enforceScreen,30));

  try{jarvisRoadTestMarker?.('V653_PATCH_READY',{});}catch(e){}
}
install();
})();
