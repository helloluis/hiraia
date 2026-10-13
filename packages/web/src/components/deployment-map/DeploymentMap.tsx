'use client';

import {useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import geometry from './philippines.generated.json';
import {downloadSnapshot, pilots, project, type Pilot} from './data';
import styles from './DeploymentMap.module.css';

type Point = {x:number;y:number};
type View = Point & {scale:number};
type Selection = {kind:'pilot'|'download';id:string} | null;
type MapMode = 'country'|'pilots'|'downloads';
const INITIAL: View = {x:70,y:50,scale:.8};
const clamp = (n:number,a:number,b:number) => Math.max(a,Math.min(b,n));
const screen = (p:Point,v:View):Point => ({x:p.x*v.scale+v.x,y:p.y*v.scale+v.y});
const countryView=(compact:boolean):View=>compact?{x:-193,y:65,scale:.68}:INITIAL;
const viewFor=(mode:MapMode,compact:boolean):View=>{
  if(mode==='country')return countryView(compact);
  if(mode==='downloads')return compact?countryView(true):{x:-95,y:50,scale:.8};
  const p=project([120.7,14.9]),scale=2.3*(compact?.58:1);
  return {scale,x:(compact?640:1200)/2-p.x*scale,y:(compact?780:760)*.47-p.y*scale};
};
const flagOffsets: Record<string,Point> = {
  calapacuan:{x:-363,y:-113}, 'better-world':{x:-350,y:38}, daanghari:{x:124,y:-130},
};
const pilotDate=(pilot:Pilot)=>new Date(`${pilot.date}T00:00:00Z`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const pilotStatus=(pilot:Pilot)=>`Pilot Site (${pilot.status==='active'?'launched':'planned'} ${pilotDate(pilot)})`;
const donationStatus=(pilot:Pilot)=>`mobile phones ${pilot.status==='active'?'donated':'to be donated'}`;
function Icon({name}:{name:'plus'|'minus'|'reset'|'arrow'|'close'}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    {name==='plus'?<path d="M12 5v14M5 12h14"/>:name==='minus'?<path d="M5 12h14"/>:name==='reset'?<><path d="M5 9a8 8 0 1 1 0 7M5 3v6h6"/></>:name==='close'?<path d="m6 6 12 12M18 6 6 18"/>:<path d="m6 18 12-12M6 6h12v12"/>}
  </svg>;
}

export function DeploymentMap({snapshot=downloadSnapshot}:{snapshot?:typeof downloadSnapshot}) {
  const downloads=snapshot.locations;
  const [view,setView]=useState<View>(INITIAL);
  const [compact,setCompact]=useState(false);
  const dimensions=useRef({width:1200,height:760});
  const width=compact?640:1200,height=compact?780:760;
  // Feather the geography in viewport space, with a wider fade as users zoom in.
  // Controls, pilot banners and the compass stay crisp above the masked scene.
  const zoomProgress=clamp((view.scale/countryView(compact).scale-1)/1.5,0,1);
  const edgeFade=14+(compact?70:100)*zoomProgress;
  const current=useRef(view), svg=useRef<SVGSVGElement>(null);
  const pointers=useRef(new Map<number,Point>());
  const moved=useRef(false);
  const gestureStart=useRef<Point>({x:0,y:0});
  const [dragging,setDragging]=useState(false);
  const [selection,setSelection]=useState<Selection>(null);
  const [mode,setMode]=useState<MapMode>('country');
  const currentMode=useRef<MapMode>('country');
  const showPilots=mode!=='downloads',showDownloads=mode!=='pilots';
  const id=useId().replace(/:/g,'');
  const selectedPilot=selection?.kind==='pilot'?pilots.find(p=>p.id===selection.id):undefined;
  const selectedDownload=selection?.kind==='download'?downloads.find(d=>d.id===selection.id):undefined;
  const snapshotDate=new Date(`${snapshot.period.lastDay}T00:00:00Z`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  // Keep labels readable at country scale, without shifting geographic anchors.
  // Equal markers show presence, never volume. Prioritize only the selected area.
  const labels=new Map<string,{x:number;y:number;anchor:'start'|'end';text:string}>();
  const occupied:{x:number;y:number;w:number;h:number}[]=[];
  const points=downloads.map(d=>screen(project(d.coordinates),view));
  for(const d of [...downloads].sort((a,b)=>Number(b.id===selectedDownload?.id)-Number(a.id===selectedDownload?.id)||a.province.localeCompare(b.province,'en'))){
    const p=screen(project(d.coordinates),view),chosen=d.id===selectedDownload?.id;
    if(p.x<30||p.x>width-30||p.y<35||p.y>height-45)continue;
    const text=view.scale>1.15||chosen?d.province:'';
    if(!text)continue;
    const w=text.length*6.6,h=18;
    for(const [dx,dy,anchor] of [[14,-10,'start'],[-14,-10,'end'],[14,23,'start'],[-14,23,'end']] as const){
      const rect={x:p.x+dx-(anchor==='end'?w:0),y:p.y+dy-h+3,w,h};
      if(rect.x<12||rect.x+w>width-12||occupied.some(b=>rect.x<b.x+b.w+4&&rect.x+w+4>b.x&&rect.y<b.y+b.h+3&&rect.y+h+3>b.y)||points.some(q=>q.x>rect.x-8&&q.x<rect.x+w+8&&q.y>rect.y-8&&q.y<rect.y+h+8))continue;
      labels.set(d.id,{x:dx,y:dy,anchor,text});occupied.push(rect);break;
    }
  }
  const update=(v:View)=>{const {width:w,height:h}=dimensions.current;const next={...v,x:clamp(v.x,-w*v.scale,w*.85),y:clamp(v.y,-h*v.scale,h*.85)};current.current=next;setView(next);};
  const local=(x:number,y:number):Point=>{
    const el=svg.current!, rect=el.getBoundingClientRect();
    // SVG uses xMidYMid meet. Account for mobile letterboxing as well as CSS pixels.
    const {width:w,height:h}=dimensions.current;
    const ratio=Math.min(rect.width/w,rect.height/h);
    return {x:(x-rect.left-(rect.width-w*ratio)/2)/ratio,y:(y-rect.top-(rect.height-h*ratio)/2)/ratio};
  };
  const zoom=(factor:number,center:Point={x:width/2,y:height/2})=>{
    const old=current.current, scale=clamp(old.scale*factor,.55,6), ratio=scale/old.scale;
    update({scale,x:center.x-(center.x-old.x)*ratio,y:center.y-(center.y-old.y)*ratio});
  };
  useEffect(()=>{
    const el=svg.current;if(!el)return;
    let measuredCompact:boolean|undefined;
    const measure=()=>{const small=el.clientWidth<650;if(small===measuredCompact)return;measuredCompact=small;dimensions.current={width:small?640:1200,height:small?780:760};setCompact(small);const v=viewFor(currentMode.current,small);current.current=v;setView(v);};
    const observer=new ResizeObserver(measure);observer.observe(el);measure();
    const wheel=(e:WheelEvent)=>{e.preventDefault();zoom(Math.exp(-clamp(e.deltaY,-100,100)*.0025),local(e.clientX,e.clientY));};
    el.addEventListener('wheel',wheel,{passive:false});
    return ()=>{observer.disconnect();el.removeEventListener('wheel',wheel);};
    // Uses current refs: keep this listener stable during gestures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const down=(e:ReactPointerEvent<SVGSVGElement>)=>{
    if((e.pointerType==='mouse'&&e.button!==0)||pointers.current.size>=2)return;
    if(pointers.current.size===0){moved.current=false;gestureStart.current={x:e.clientX,y:e.clientY};}
    pointers.current.set(e.pointerId,local(e.clientX,e.clientY));
    // Observe touches on pins and banners too. Preserve native single taps by
    // waiting to capture a marker's pointer until it becomes a drag or pinch.
    if(pointers.current.size===2){
      moved.current=true;
      for(const pointerId of pointers.current.keys())e.currentTarget.setPointerCapture(pointerId);
    }else if(!(e.target as Element).closest('[role="button"]')){
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDragging(true);
  };
  const move=(e:ReactPointerEvent<SVGSVGElement>)=>{
    const old=pointers.current.get(e.pointerId);if(!old)return;
    if(!moved.current&&Math.hypot(e.clientX-gestureStart.current.x,e.clientY-gestureStart.current.y)<4)return;
    const next=local(e.clientX,e.clientY), before=[...pointers.current.values()];
    pointers.current.set(e.pointerId,next);
    moved.current=true;
    if(!e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.setPointerCapture(e.pointerId);
    if(pointers.current.size===2){
      const after=[...pointers.current.values()];
      const mid=(p:Point[])=>({x:(p[0]!.x+p[1]!.x)/2,y:(p[0]!.y+p[1]!.y)/2});
      const distance=(p:Point[])=>Math.hypot(p[0]!.x-p[1]!.x,p[0]!.y-p[1]!.y);
      const a=mid(before),b=mid(after),v=current.current,s=clamp(v.scale*distance(after)/Math.max(1,distance(before)),.55,6);
      update({scale:s,x:b.x-(a.x-v.x)*s/v.scale,y:b.y-(a.y-v.y)*s/v.scale});
    }else if(pointers.current.size===1){const v=current.current;update({...v,x:v.x+next.x-old.x,y:v.y+next.y-old.y});}
  };
  const up=(e:ReactPointerEvent<SVGSVGElement>)=>{pointers.current.delete(e.pointerId);setDragging(pointers.current.size>0);};
  const go=(next:MapMode)=>{
    currentMode.current=next;setMode(next);setSelection(null);update(viewFor(next,compact));
  };
  const select=(s:Selection)=>{if(!moved.current)setSelection(s);};
  const keySelect=(event:React.KeyboardEvent, value:Selection)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelection(value);}};
  const pin=(pilot:Pilot)=>{
    const p=screen(project(pilot.coordinates),view), offset=compact?{x:16,y:-125}:(flagOffsets[pilot.id] ?? {x:24,y:-100});
    const x=clamp(p.x+offset.x,18,width-290),y=clamp(p.y+offset.y,76,height-120);
    const left=offset.x<0, end={x:left?x+268:x,y:y+50};
    const chosen=selectedPilot?.id===pilot.id;
    // Separate the two Manila-area pin heads without moving their geographic feet.
    const head={x:p.x+(pilot.id==='better-world'?-7:pilot.id==='daanghari'?7:0),y:p.y-(pilot.id==='daanghari'?41:25)};
    if(p.x < -30 || p.x > width+30 || p.y < -30 || p.y > height+30)return null;
    const showFlag=(!compact||chosen)&&p.y>120&&p.y<height-80;
    return <g key={pilot.id} className={`${styles.pilot} ${pilot.status==='planned'?styles.planned:''} ${chosen?styles.selected:''}`}>
      {showFlag&&<path className={styles.leader} d={`M${head.x} ${head.y}L${end.x+(left?22:-22)} ${end.y}H${end.x}`} />}
      <circle cx={head.x} cy={head.y} r="16" fill="transparent" role="button" tabIndex={0} aria-label={`Open ${pilot.name} details`} onClick={()=>select({kind:'pilot',id:pilot.id})} onKeyDown={e=>keySelect(e,{kind:'pilot',id:pilot.id})}/>
      <ellipse cx={p.x} cy={p.y+3} rx="10" ry="4" className={styles.pinFoot}/>
      <path d={`M${p.x} ${p.y}L${head.x} ${head.y}`} className={styles.pinStem}/>
      <circle cx={head.x} cy={head.y} r="5" className={styles.pinHead}/>
      {showFlag&&<g transform={`translate(${x} ${y})`} role="button" tabIndex={showPilots?0:-1}
        aria-label={`${pilot.name}, ${pilotStatus(pilot)}, ${pilot.phones} ${donationStatus(pilot)}`}
        onClick={()=>select({kind:'pilot',id:pilot.id})}
        onKeyDown={e=>keySelect(e,{kind:'pilot',id:pilot.id})}>
        <path d="M4 5H271L261 51l10 49H4Z" className={styles.flagShadow}/>
        <path d="M0 0H268L258 46l10 49H0Z" className={styles.flag}/>
        <text x="17" y="20" className={styles.flagEyebrow}>{`${pilot.status==='active'?'●':'○'}  ${pilotStatus(pilot)}`}</text>
        <text x="17" y="47" className={styles.flagName}>{pilot.name}</text>
        <text x="17" y="65" className={styles.flagPlace}>{pilot.place}</text>
        <text x="17" y="84" className={styles.flagCount}>{pilot.phones} {donationStatus(pilot)}</text>
        <text x="236" y="84" className={styles.flagArrow}>↗</text>
      </g>}
    </g>;
  };
  return <section className={styles.section} aria-labelledby={`${id}-title`}>
    <header className={styles.header}>
      <h2 id={`${id}-title`}>A Hiraia Archipelago</h2>
    </header>
    <div className={styles.frame}>
      <div className={styles.toolbar}>
        <div className={styles.tabs} aria-label="Map view">
          {([['country','Pilots + Downloads'],['pilots','Pilot sites'],['downloads','Direct Downloads']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={mode===key} onClick={()=>go(key)}>{label}</button>)}
        </div>
      </div>
      <div className={styles.viewport}>
        <svg ref={svg} viewBox={`0 0 ${width} ${height}`} className={`${styles.map} ${dragging?styles.dragging:''}`}
          role="group" aria-label="Interactive deployment map of the Philippines. Drag to pan, pinch or use plus and minus to zoom, or select an area."
          tabIndex={0} onPointerDownCapture={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onLostPointerCapture={e=>{if(e.target===e.currentTarget)up(e);}}
          onKeyDown={e=>{if(e.target!==e.currentTarget)return;const v=current.current;const delta:Record<string,Point>={ArrowLeft:{x:40,y:0},ArrowRight:{x:-40,y:0},ArrowUp:{x:0,y:40},ArrowDown:{x:0,y:-40}};if(delta[e.key]){e.preventDefault();update({...v,x:v.x+delta[e.key]!.x,y:v.y+delta[e.key]!.y});}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}else if(e.key==='-'){e.preventDefault();zoom(.8);}else if(e.key==='Home'){e.preventDefault();go('country');}}}>
          <defs>
            <pattern id={`${id}-dots`} width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".45" fill="#4D4740" opacity=".16"/></pattern>
            <linearGradient id={`${id}-fade-x`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={width} y2="0">
              <stop offset="0" stopColor="white" stopOpacity="0"/>
              <stop offset={edgeFade/width} stopColor="white"/>
              <stop offset={1-edgeFade/width} stopColor="white"/>
              <stop offset="1" stopColor="white" stopOpacity="0"/>
            </linearGradient>
            <linearGradient id={`${id}-fade-y`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={height}>
              <stop offset="0" stopColor="white" stopOpacity="0"/>
              <stop offset={edgeFade/height} stopColor="white"/>
              <stop offset={1-edgeFade/height} stopColor="white"/>
              <stop offset="1" stopColor="white" stopOpacity="0"/>
            </linearGradient>
            <mask id={`${id}-edge-x`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} style={{maskType:'alpha'}}>
              <rect width={width} height={height} fill={`url(#${id}-fade-x)`}/>
            </mask>
            <mask id={`${id}-edge-y`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} style={{maskType:'alpha'}}>
              <rect width={width} height={height} fill={`url(#${id}-fade-y)`}/>
            </mask>
          </defs>
          <g data-testid="map-scene" data-edge-fade={edgeFade} mask={`url(#${id}-edge-x)`}>
            <g mask={`url(#${id}-edge-y)`}>
              <rect width={width} height={height} fill={`url(#${id}-dots)`}/>
              <g className={styles.graticule} transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
                {[116,118,120,122,124,126,128].map(lon=>{const a=project([lon,22]),b=project([lon,4]);return <path key={lon} d={`M${a.x} ${a.y}L${b.x} ${b.y}`}/>;})}
                {[4,6,8,10,12,14,16,18,20,22].map(lat=>{const a=project([115,lat]),b=project([129,lat]);return <path key={lat} d={`M${a.x} ${a.y}L${b.x} ${b.y}`}/>;})}
              </g>
              <g transform={`translate(${view.x} ${view.y+5}) scale(${view.scale})`} className={styles.landShadow} aria-hidden="true">
                {geometry.features.map(f=><path key={f.name} d={f.path}/>)}
              </g>
              <g data-testid="map-land" transform={`translate(${view.x} ${view.y}) scale(${view.scale})`} className={styles.land}>
                {geometry.features.map(f=><path key={f.name} d={f.path}><title>{f.name}</title></path>)}
              </g>
              <g className={styles.mapLabels} aria-hidden="true">
                {[['LUZON',122.15,17.15],['VISAYAS',124,12.25],['MINDANAO',125,7.15],['PALAWAN',118.4,10.55]].map(([label,lon,lat])=>{const p=screen(project([Number(lon),Number(lat)]),view);return <text key={label} x={p.x} y={p.y} transform={`rotate(-8 ${p.x} ${p.y})`}>{label}</text>;})}
              </g>
              <g className={styles.seaLabels} aria-hidden="true">
                {[['WEST PHILIPPINE SEA',117.8,15],['PHILIPPINE SEA',125.2,16],['SULU SEA',119.8,8.3]].map(([label,lon,lat])=>{const p=screen(project([Number(lon),Number(lat)]),view);return <text key={label} x={p.x} y={p.y} transform={`rotate(-8 ${p.x} ${p.y})`}>{label}</text>;})}
              </g>
              {showDownloads&&<g data-testid="download-markers" className={`${styles.downloads} ${mode==='downloads'?styles.downloadFocus:''}`}>
                {downloads.map(d=>{const p=screen(project(d.coordinates),view),chosen=selectedDownload?.id===d.id,label=labels.get(d.id);if(p.x<12||p.x>width-12||p.y<12||p.y>height-12)return null;return <g key={d.id} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0}
                  aria-label={`${d.province}: direct download location`}
                  className={chosen?styles.selectedDownload:undefined}
                  onClick={()=>select({kind:'download',id:d.id})} onKeyDown={e=>keySelect(e,{kind:'download',id:d.id})}>
                  <title>{`${d.province} · Direct downloads`}</title>
                  <circle r="12" fill="transparent" stroke="none"/>
                  {mode==='downloads'&&<circle r="13" className={styles.downloadHalo}/>}
                  <circle r={chosen?11:mode==='downloads'?8:6} className={styles.downloadRing}/><circle r={mode==='downloads'?3.5:2.5} className={styles.downloadDot}/>
                  {label&&<text x={label.x} y={label.y} textAnchor={label.anchor} className={styles.provinceLabel}>{label.text}</text>}
                </g>;})}
              </g>}
            </g>
          </g>
          {showPilots&&<g>{pilots.map(pin)}</g>}
          <g className={styles.compass} transform={`translate(${width-82} ${height-174}) rotate(-17)`} aria-hidden="true">
            <circle r="34"/><circle r="29"/><path d="M0-48V48M-48 0H48"/>
            <path d="m0-31 7 31-7 31-7-31Z"/><path d="m-31 0 31-7 31 7-31 7Z"/>
            <path d="m0-31 7 31H0Z" fill="currentColor"/><text y="-58" textAnchor="middle">N</text><text y="65" textAnchor="middle">S</text><text x="-58" y="4" textAnchor="middle">W</text><text x="59" y="4" textAnchor="middle">E</text>
          </g>
        </svg>
        <div className={styles.zoomControls} aria-label="Map controls">
          <button type="button" aria-label="Zoom in" onClick={()=>zoom(1.25)} disabled={view.scale>=6}><Icon name="plus"/></button>
          <span aria-live="polite">{Math.round(view.scale/countryView(compact).scale*100)}%</span>
          <button type="button" aria-label="Zoom out" onClick={()=>zoom(.8)} disabled={view.scale<=.55}><Icon name="minus"/></button>
          <button type="button" aria-label="Reset map" onClick={()=>go('country')}><Icon name="reset"/></button>
        </div>
        {(selectedPilot||selectedDownload)&&<aside className={styles.detail} aria-live="polite">
          <button type="button" className={styles.close} aria-label="Close map detail" onClick={()=>setSelection(null)}><Icon name="close"/></button>
          <p className={styles.eyebrow}>{selectedPilot?pilotStatus(selectedPilot):'DIRECT DOWNLOADS'}</p>
          <h3>{selectedPilot?.name??selectedDownload?.province}</h3>
          {selectedPilot?<>
            <p>{selectedPilot.place}</p>
            <strong className={styles.detailNumber}>{selectedPilot.phones}<span> {donationStatus(selectedPilot)}</span></strong>
            {selectedPilot.locationPrecision==='area'&&<p className={styles.detailNote}>Approximate venue location.</p>}
          </>:<p className={styles.downloadPlaces}>{selectedDownload?.cities.map(c=>c.city).join(' · ')}</p>}

        </aside>}
      </div>
      <footer className={styles.mapFooter}>
        <div className={styles.legend} aria-label="Map legend">
          {showPilots&&<><span><i className={styles.legendPin}/>Pilot sites</span><span className={styles.plannedKey}><i/>Planned</span></>}
          {showDownloads&&<span><i className={styles.legendDot}/>Direct downloads</span>}
        </div>
        <span className={styles.hint}>Drag to move · Scroll or pinch to zoom</span>
      </footer>
    </div>
    <div className={styles.below}>
      <p>Approximate areas from download clicks · {snapshotDate}</p>
      <details className={styles.attribution}>
        <summary>Map sources</summary>
        <div><a href={geometry.source.url} target="_blank" rel="noreferrer">geoBoundaries / NAMRIA / PSA / OCHA · 2020 · CC BY 3.0 IGO ↗</a><a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames · CC BY 4.0 ↗</a></div>
      </details>
    </div>
    {showPilots&&<div className={styles.accessibleList} aria-label="Pilot directory">
      {pilots.map(p=><button type="button" key={p.id} onClick={()=>{go('pilots');setSelection({kind:'pilot',id:p.id});}}>{p.name} · {p.phones} {donationStatus(p)}</button>)}
    </div>}
  </section>;
}
