(()=>{
'use strict';
function install(){
  if(typeof jarvisStartOriginGuard!=='function'){
    setTimeout(install,50);return;
  }
  const originalStartOriginGuard=jarvisStartOriginGuard;
  jarvisStartOriginGuard=function(){
    const result=originalStartOriginGuard.apply(this,arguments);
    if(!result)return result;
    if(result.status==='NO_ROUTE'||result.status==='INVALID_POINTS'||result.status==='REVERSED')return result;

    const start=Number(result.startDistance);
    const end=Number(result.endDistance);

    // START integrity must primarily prove that the computed route begins near the rider.
    // Google Routes may legitimately terminate at an accessible road/entrance some distance
    // from a POI pin (large temples, parks, stations, shopping centres, private roads, etc.).
    // Do not block navigation merely because the drivable endpoint is 80-250 m from the POI pin.
    if(Number.isFinite(start)&&start>80){
      result.status='CORRUPT';
      result.blocked=true;
      result.reason=`ルート起点が現在地から${Math.round(start)}mずれています。再検索してください`;
      return result;
    }

    if(Number.isFinite(end)&&end>750){
      result.status='CORRUPT';
      result.blocked=true;
      result.reason=`ルート終点が目的地から${Math.round(end)}m離れています。再検索してください`;
      return result;
    }

    result.blocked=false;
    if(Number.isFinite(end)&&end>250){
      result.status='WARN';
      result.reason=`走行可能なルート終点が目的地ピンから${Math.round(end)}m離れています`;
    }else if(Number.isFinite(start)&&start>30){
      result.status='WARN';
      result.reason=`ルート起点に${Math.round(start)}mのずれがあります`;
    }else{
      result.status='OK';
      result.reason='';
    }

    try{
      if(typeof jarvisRoadTestMarker==='function')jarvisRoadTestMarker('START_GUARD_V651',{startDistance:Number.isFinite(start)?start:null,endDistance:Number.isFinite(end)?end:null,status:result.status,blocked:result.blocked});
    }catch(e){}
    jarvisRouteIntegrity=result;
    return result;
  };
}
install();
})();
