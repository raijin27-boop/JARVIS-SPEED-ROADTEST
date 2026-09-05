from pathlib import Path
p=Path('app.js')
s=p.read_text()
insertion="""let jarvisTurnArrowLine=null;
let jarvisPreviewTurnArrowLines=[];
function jarvisClearPreviewTurnArrows(){
  for(const line of jarvisPreviewTurnArrowLines){try{line?.setMap?.(null)}catch(e){}}
  jarvisPreviewTurnArrowLines=[];
}
function jarvisRenderPreviewTurnArrows(){
  jarvisClearPreviewTurnArrows();
  if(!navGoogleMap||navMode!=='ROUTE'||navSessionStarted||!routePreviewActive||!routeData)return;
  if(!jarvisMotionPreparePath())return;
  const events=jarvisTurnEvents();
  for(const turn of events){
    const win=jarvisTurnArrowWindow(turn);
    if(!win)continue;
    const pts=[],s0=win.startS,s1=win.endS;
    if(!Number.isFinite(s0)||!Number.isFinite(s1)||s1<=s0)continue;
    const count=Math.max(10,Math.min(40,Math.ceil((s1-s0)/2)));
    for(let i=0;i<=count;i++){
      const p=jarvisMotionPointAtS(s0+(s1-s0)*(i/count));
      if(p)pts.push({lat:p.lat,lng:p.lng});
    }
    if(pts.length<2)continue;
    const icons=[{icon:{path:google.maps.SymbolPath.FORWARD_CLOSED_ARROW,scale:win.branch?4.8:4.2,strokeColor:'#fff',strokeWeight:1.6,fillColor:'#fff',fillOpacity:.88},offset:'100%'}];
    const line=new google.maps.Polyline({map:navGoogleMap,path:pts,strokeColor:'#fff',strokeOpacity:.76,strokeWeight:win.branch?6:5,zIndex:90,clickable:false,icons});
    jarvisPreviewTurnArrowLines.push(line);
  }
}
"""
if 'function jarvisRenderPreviewTurnArrows()' not in s:
    anchor='let jarvisTurnArrowLine=null;\n'
    if anchor not in s: raise SystemExit('missing turn-arrow anchor')
    s=s.replace(anchor,insertion,1)
render_anchor="function jarvisRenderRoute(){\n  const colors=['#238cff','#72d2ff','#8ee6a8'];"
if 'setTimeout(jarvisRenderPreviewTurnArrows,0);' not in s:
    if render_anchor not in s: raise SystemExit('missing route-render anchor')
    s=s.replace(render_anchor,"function jarvisRenderRoute(){\n  setTimeout(jarvisRenderPreviewTurnArrows,0);\n  const colors=['#238cff','#72d2ff','#8ee6a8'];",1)
s=s.replace("'v6.14.58-ROADTEST-dev'","'v6.14.59-ROADTEST-dev'")
p.write_text(s)
idx=Path('index.html')
t=idx.read_text().replace('JARVIS Road Test v6.14.58-ROADTEST-20260905T1530JST','JARVIS Road Test v6.14.59-ROADTEST-20260905T1545JST')
idx.write_text(t)
