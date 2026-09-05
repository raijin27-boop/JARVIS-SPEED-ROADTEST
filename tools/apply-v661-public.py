from pathlib import Path
p=Path('app.js'); s=p.read_text()
old="""  const branch=(kind==='EXIT'||kind==='DIVERGE'||kind==='MERGE');
  const total=branch?26:19;
  const before=total*(2/3),after=total*(1/3);
  const anchor=Number.isFinite(Number(turn.s))?Number(turn.s):((Number(turn.startS)+Number(turn.endS))/2);
  if(!Number.isFinite(anchor))return null;
  return{startS:Math.max(0,anchor-before),endS:Math.min(jarvisMotion.total,anchor+after),maxDistance:branch?145:105,branch};
"""
new="""  const branch=(kind==='EXIT'||kind==='DIVERGE'||kind==='MERGE');
  // v6.14.61: 2:1 means the actual legs around the bend: approach=2, exit=1.
  // The arrow therefore follows the bend and its arrowhead lands on the road AFTER the turn.
  const approach=branch?16:12;
  const exit=approach/2;
  let bendStart=Number(turn.startS),bendEnd=Number(turn.endS);
  if(!Number.isFinite(bendStart))bendStart=Number(turn.s);
  if(!Number.isFinite(bendEnd))bendEnd=Number(turn.s);
  if(!Number.isFinite(bendStart)||!Number.isFinite(bendEnd))return null;
  if(bendEnd<bendStart){const t=bendStart;bendStart=bendEnd;bendEnd=t;}
  return{startS:Math.max(0,bendStart-approach),endS:Math.min(jarvisMotion.total,bendEnd+exit),maxDistance:branch?145:105,branch};
"""
if old not in s: raise SystemExit('v660 block missing')
s=s.replace(old,new,1).replace("'v6.14.60-ROADTEST-dev'","'v6.14.61-ROADTEST-dev'")
p.write_text(s)
i=Path('index.html'); t=i.read_text().replace('JARVIS Road Test v6.14.60-ROADTEST-20260905T1605JST','JARVIS Road Test v6.14.61-ROADTEST-20260905T1635JST'); i.write_text(t)
