import {DEFAULT_CONFIG,PRESETS,normalizeConfig,setBay,resizeConfig,dimensions,quote,serializeConfig,parseConfig,describeConfig,formatMoney} from './model.js';
import {createScene} from './scene.js';

const $=id=>document.getElementById(id);
let config=normalizeConfig(DEFAULT_CONFIG);
let tool='window';
let selectedBay=null;
let roofOpen=false;
let showDimensions=true;
let sceneReady=false;
const history=[];
const future=[];
let toastTimer;
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;},4200);}
function make(tag,text='',className=''){const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;}
function title(value){return value.charAt(0).toUpperCase()+value.slice(1);}
const scene=createScene($('scene'),{
  onBayClick:(facade,index)=>editBay(facade,index),
  onReady:()=>{sceneReady=true;$('scene-loading').hidden=true;},
  onError:()=>{sceneReady=false;$('scene-loading').hidden=true;$('scene-fallback').hidden=false;$('save-image').disabled=true;}
});

function editBay(facade,index){
  const change=setBay(config,facade,index,tool);
  selectedBay={facade,index};
  if(change.notice){toast(change.notice);scene.setSelectedBay?.(facade,index);return;}
  apply(change.config);
  scene.setSelectedBay?.(facade,index);
  toast(`${title(facade)} bay ${index+1}: ${tool==='door'?'entrance moved':tool+' panel'}.`);
}
function apply(input,{remember=true}={}){
  const next=normalizeConfig(input);
  if(remember&&serializeConfig(next)!==serializeConfig(config)){history.push(serializeConfig(config));if(history.length>40)history.shift();future.length=0;}
  config=next;render();
}
function render(){
  const size=dimensions(config),cost=quote(config);
  $('stat-area').replaceChildren(document.createTextNode(String(size.area)+' '),make('small','m²'));
  $('stat-size').replaceChildren(document.createTextNode(`${size.length} × ${size.width} `),make('small','m'));
  $('stat-modules').textContent=String(config.modules).padStart(2,'0');
  $('modules-count').textContent=config.modules;
  $('modules-minus').disabled=config.modules<=1;$('modules-plus').disabled=config.modules>=3;
  $('finish-name').textContent=title(config.color);
  $('design-title').textContent=config.modules===1?'Solo studio':config.modules===2?'Team space':'Project hub';
  for(const button of document.querySelectorAll('[data-color]'))button.setAttribute('aria-pressed',String(button.dataset.color===config.color));
  for(const button of document.querySelectorAll('[data-length]'))button.setAttribute('aria-pressed',String(Number(button.dataset.length)===config.length));
  for(const button of document.querySelectorAll('[data-preset]')){
    const preset=PRESETS.find(item=>item.id===button.dataset.preset);
    button.setAttribute('aria-pressed',String(preset&&serializeConfig(preset.config)===serializeConfig(config)));
  }
  for(const key of ['deck','partition','furniture'])$(`extra-${key}`).checked=config[key];
  $('extra-insulation').checked=config.insulation==='plus';
  $('estimate-total').textContent=formatMoney(cost.total);
  $('estimate-subtotal').textContent=formatMoney(cost.subtotal);$('estimate-vat').textContent=formatMoney(cost.vat);$('estimate-final').textContent=formatMoney(cost.total);
  $('estimate-lines').replaceChildren(...cost.items.map(item=>{
    const row=make('tr');row.append(make('td',item.label),make('td',`${item.quantity} ${item.unit}`),make('td',formatMoney(item.unitPrice)),make('td',formatMoney(item.total)));return row;
  }));
  const focused=document.activeElement;
  const focusedBay=$('facade-bays').contains(focused)?{facade:focused.dataset.facade,index:focused.dataset.index}:null;
  $('facade-bays').replaceChildren(...['front','rear'].map(facade=>{
    const row=make('div','', 'facade-row');
    const label=make('div','', 'facade-row-label');label.append(make('span',`${facade==='front'?'FRONT':'REAR'} ELEVATION`),make('span',`${config.length} m`));
    const grid=make('div','', 'bay-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label',`${title(facade)} facade bays`);
    config[facade].forEach((type,index)=>{
      const button=make('button','', 'bay');button.type='button';button.dataset.type=type;button.dataset.facade=facade;button.dataset.index=String(index);button.setAttribute('aria-label',`${title(facade)} bay ${index+1}: ${type}. Apply ${tool}.`);
      const selected=selectedBay?.facade===facade&&selectedBay.index===index;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
      button.append(make('span',String(index+1).padStart(2,'0')),make('i'));button.addEventListener('click',()=>editBay(facade,index));grid.append(button);
    });row.append(label,grid);return row;
  }));
  if(focusedBay)$('facade-bays').querySelector(`[data-facade="${focusedBay.facade}"][data-index="${focusedBay.index}"]`)?.focus({preventScroll:true});
  $('undo').disabled=history.length===0;$('redo').disabled=future.length===0;
  scene.update(config);scene.setRoofOpen(roofOpen);scene.setDimensions(showDimensions);
  if(selectedBay&&selectedBay.index<size.bays)scene.setSelectedBay?.(selectedBay.facade,selectedBay.index);else selectedBay=null;
}

for(const button of document.querySelectorAll('[data-preset]'))button.addEventListener('click',()=>{
  const preset=PRESETS.find(item=>item.id===button.dataset.preset);if(!preset)return;selectedBay=null;apply(preset.config);toast(`${preset.label} selected.`);
});
for(const button of document.querySelectorAll('[data-length]'))button.addEventListener('click',()=>{selectedBay=null;apply(resizeConfig(config,Number(button.dataset.length)));});
for(const button of document.querySelectorAll('[data-color]'))button.addEventListener('click',()=>apply({...config,color:button.dataset.color}));
for(const button of document.querySelectorAll('[data-tool]'))button.addEventListener('click',()=>{
  tool=button.dataset.tool;for(const b of document.querySelectorAll('[data-tool]'))b.setAttribute('aria-pressed',String(b===button));
  // Update keyboard labels without rebuilding the geometry or stealing focus.
  for(const facade of ['front','rear'])for(const [index,type]of config[facade].entries()){
    const b=$('facade-bays').querySelectorAll(`.facade-row:nth-child(${facade==='front'?1:2}) .bay`)[index];b?.setAttribute('aria-label',`${title(facade)} bay ${index+1}: ${type}. Apply ${tool}.`);
  }
});
$('modules-minus').addEventListener('click',()=>apply({...config,modules:config.modules-1}));
$('modules-plus').addEventListener('click',()=>apply({...config,modules:config.modules+1}));
for(const key of ['deck','partition','furniture'])$(`extra-${key}`).addEventListener('change',()=>apply({...config,[key]:$(`extra-${key}`).checked}));
$('extra-insulation').addEventListener('change',()=>apply({...config,insulation:$('extra-insulation').checked?'plus':'standard'}));
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
  scene.setView(button.dataset.view);for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b===button));
});
$('roof-toggle').addEventListener('click',()=>{roofOpen=!roofOpen;scene.setRoofOpen(roofOpen);$('roof-toggle').setAttribute('aria-pressed',String(roofOpen));$('roof-toggle').replaceChildren(document.createTextNode(roofOpen?'Lower roof ':'Lift roof '),make('span',roofOpen?'↓':'↑'));});
$('dimensions-toggle').addEventListener('click',()=>{showDimensions=!showDimensions;scene.setDimensions(showDimensions);$('dimensions-toggle').setAttribute('aria-pressed',String(showDimensions));});
$('undo').addEventListener('click',()=>{if(!history.length)return;future.push(serializeConfig(config));apply(parseConfig(history.pop()),{remember:false});toast('Change undone.');});
$('redo').addEventListener('click',()=>{if(!future.length)return;history.push(serializeConfig(config));apply(parseConfig(future.pop()),{remember:false});toast('Change restored.');});
$('reset-config').addEventListener('click',()=>{selectedBay=null;roofOpen=false;showDimensions=true;scene.setView('iso');$('roof-toggle').setAttribute('aria-pressed','false');$('roof-toggle').replaceChildren(document.createTextNode('Lift roof '),make('span','↑'));$('dimensions-toggle').setAttribute('aria-pressed','true');for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view==='iso'));apply(DEFAULT_CONFIG);toast('Original design restored.');});

function download(url,name,cleanup=false){const anchor=make('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();if(cleanup)setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('save-config').addEventListener('click',()=>{download(URL.createObjectURL(new Blob([serializeConfig(config)],{type:'application/json'})),'modular-studio-design.json',true);toast('Design exported as JSON. Open it here to continue later.');});
$('load-config').addEventListener('click',()=>{$('config-file').click();});
$('config-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>100000)throw new Error('Choose a Modular Studio design smaller than 100 kB.');const next=parseConfig(await file.text());selectedBay=null;apply(next);toast('Design loaded. The file stayed in your browser.');}catch(error){toast(error.message||'This design could not be opened.');}finally{event.target.value='';}
});
$('save-image').addEventListener('click',()=>{try{const png=scene.capture();if(!png){toast('An image needs the 3D preview to be available.');return;}download(png,'modular-studio-view.png');toast('Model view exported as PNG.');}catch{toast('The image could not be captured. Try a different view.');}});

function createProjectSheet(){
  const sheet=$('print-sheet');sheet.replaceChildren();const size=dimensions(config);
  sheet.append(make('p','MODULAR STUDIO / CONCEPT SERIES 01','print-brand'),make('h1','Your modular space.'),make('p',describeConfig(config)));
  const grid=make('div','', 'spec-grid');
  for(const[label,value]of[['Exterior finish',title(config.color)],['Module height','2.8 m concept height'],['Entry door','One, position as selected'],['Insulation',config.insulation==='plus'?'Enhanced demo package':'Standard demo package'],['Front deck',config.deck?`${size.length} × 1.5 m`:'Not included'],['Interior',`${config.partition?'Partition · ':''}${config.furniture?'Furniture package':'Unfurnished'}`]]){
    const cell=make('div');cell.append(make('strong',label),make('span',value));grid.append(cell);
  }sheet.append(grid);
  if(sceneReady){try{const png=scene.capture();if(png){const image=make('img');image.src=png;image.alt='Current 3D concept view';sheet.append(image);}}catch{/* Specs remain printable when capture is unavailable. */}}
  sheet.append(make('h2','Configuration & sample estimate'),$('estimate-lines').closest('table').cloneNode(true));
  sheet.append(make('p',`Front facade: ${config.front.map((panel,index)=>`${index+1} ${panel}`).join(' · ')}. Rear facade: ${config.rear.map((panel,index)=>`${index+1} ${panel}`).join(' · ')}.`));
  sheet.append(make('p','Fictional demo prices in EUR, including 19% illustrative VAT. No commercial offer or enquiry. Generic dimensions; no structural, building-code, accessibility, transport or installation checks. The design is a discussion aid, not a construction plan.','print-note'));
  const preview=sheet.cloneNode(true);preview.removeAttribute('id');preview.className='sheet-preview-content';
  for(const element of preview.querySelectorAll('[id]'))element.removeAttribute('id');
  $('sheet-preview').replaceChildren(preview);$('sheet-dialog').showModal();
}
$('project-sheet').addEventListener('click',createProjectSheet);
$('sheet-close').addEventListener('click',()=>$('sheet-dialog').close());
$('sheet-print').addEventListener('click',()=>window.print());
render();
window.addEventListener('pagehide',event=>{if(!event.persisted)scene.dispose();});
