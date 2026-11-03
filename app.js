const $=id=>document.getElementById(id);
const state={photos:[null,null,null]};
if(localStorage.getItem('glowup-theme')==='dark')document.body.classList.add('dark');
$('theme').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('glowup-theme',document.body.classList.contains('dark')?'dark':'light')};
for(const input of document.querySelectorAll('[data-photo]'))input.addEventListener('change',()=>{const i=Number(input.dataset.photo);const f=input.files?.[0];if(!f)return; if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>12e6){alert('JPEG, PNG эсвэл WebP зураг (12MB хүртэл) сонгоно уу.');input.value='';return;}state.photos[i]=f;const url=URL.createObjectURL(f);const img=new Image();img.src=url;img.alt='Uploaded photo';img.onload=()=>URL.revokeObjectURL(url);$(`pv${i}`).replaceChildren(img)});
const make=(tag,content,cls)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=String(content);return e};
function block(title,render){const card=make('div',undefined,'card');card.append(make('h2',title));render(card);$('sections').append(card)}
function paragraphs(card,arr){for(const x of arr||[])card.append(make('p',x))}
function item(card,title,detail,action){const e=make('div',undefined,'item');e.append(make('b',title));if(detail)e.append(make('p',detail));if(action)e.append(make('small',action));card.append(e)}
let reportId=null;
let viewVersion=0;
const recoveryKey='glowup-report-id';
function rememberReport(id){
 try{if(id)localStorage.setItem(recoveryKey,id);else localStorage.removeItem(recoveryKey)}catch{}
}
async function recoverReport(){
 let id;try{id=localStorage.getItem(recoveryKey)}catch{return}
 if(!id)return;
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)){rememberReport(null);return}
 const version=++viewVersion;
 $('submit').disabled=true;
 try{
  const response=await fetch('/api/recover?id='+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});
  const body=await response.json();
  if(version!==viewVersion)return;
  if(response.status===404){rememberReport(null);showError('Тайлан сэргээх боломжгүй байна. Хугацаа дууссан эсвэл энэ хөтчийн эрх байхгүй.');return}
  if(!response.ok)throw Error(body.error||'Тайланг сэргээж чадсангүй. Дахин ачаална уу.');
  reportId=body.reportId;rememberReport(reportId);renderPreview(body.preview);
  if(body.paid)await paymentRequest('report');
 }catch(error){if(version===viewVersion)showError(error.message)}
 finally{if(version===viewVersion)$('submit').disabled=false}
}
function renderPreview(p){
 $('form').classList.add('hidden');$('result').classList.remove('hidden');
 $('sections').replaceChildren();$('summary').textContent=p.summary;
 for(const key of ['headline','scoreNote'])$(key).textContent=p[key];
 $('score').textContent=p.score===null?'—':p.score+'/100';
 $('potential').textContent=p.potential===null?'—':p.potential+'/100';
 const labels={FRONT:'Нүүрний зураг',SIDE:'Хажуугийн зураг',FULL:'Бүтэн биеийн зураг'};
 const confidence={high:'Тод харагдсан',medium:'Дунд зэргийн итгэлтэй',low:'Тодорхой бус'};
 const observations=$('previewObservations');observations.replaceChildren();
 for(const x of p.observations||[]){
  const section=make('div',undefined,'photo-observation');
  section.append(make('h3',labels[x.photo]||x.photo||'Зургийн ажиглалт'),make('p',x.detail));
  if(x.confidence)section.append(make('small',confidence[x.confidence.toLowerCase()]||x.confidence));
  observations.append(section);
 }
 const priority=$('previewPriority');priority.replaceChildren();
 $('priorityCard').classList[p.priority?'remove':'add']('hidden');
 if(p.priority){
  priority.append(make('h3',p.priority.title),make('p',p.priority.why));
  const action=make('div',undefined,'preview-action');
  action.append(make('b','Одоо хийх алхам'),make('p',p.priority.action));priority.append(action);
 }
 const roast=$('previewRoast');roast.replaceChildren();
 $('roastCard').classList[p.roast?.joke?'remove':'add']('hidden');
 if(p.roast?.joke){
  roast.append(make('p','“'+p.roast.joke+'”','roast-quote'));
  if(p.roast.evidence)roast.append(make('p',p.roast.evidence));
  if(p.roast.fix)roast.append(make('p','Яаж засах вэ: '+p.roast.fix,'foot'));
 }
 $('previewGate').classList.remove('hidden');$('fullReport').classList.add('hidden');
 $('paymentStatus').textContent='';window.scrollTo({top:0,behavior:'smooth'});
}
function render(r){$('form').classList.add('hidden');$('result').classList.remove('hidden');$('sections').replaceChildren();$('headline').textContent=r.headline;$('summary').textContent=r.summary;$('score').textContent=r.score+'/100';$('potential').textContent=r.potential+'/100';$('scoreNote').textContent=r.scoreNote;
 $('previewGate').classList.add('hidden');
 $('fullReport').classList.remove('hidden');
 block('01 / Зургийн ажиглалт',c=>{for(const x of r.observations)item(c,x.photo+' · '+x.confidence,x.detail)});
 block('02 / Хамгийн чухал 3 өөрчлөлт',c=>{for(const x of r.priorities)item(c,x.title,x.why,x.action)});
 block('03 / Roast Report',c=>{if(!r.roasts.length)paragraphs(c,['Энэ удаа зохиомол шүүмжлэл хийхгүй.']);for(const x of r.roasts){const d=make('div',undefined,'roast');d.append(make('strong','“'+x.joke+'”'),make('p',x.evidence),make('small','Яаж засах вэ: '+x.fix));c.append(d)}});
 block('04 / Үс засалт',c=>{for(const x of r.haircuts)item(c,x.name,x.reason,'Арчилгаа: '+x.maintenance);item(c,'Үсчинд хэлэх үг',r.barberCard);const b=make('button','Зааврыг хуулах','pill');b.onclick=()=>navigator.clipboard?.writeText(r.barberCard);c.append(b)});
 block('05 / Арьс ба grooming',c=>{c.append(make('h3','Арьс'));paragraphs(c,r.skin);c.append(make('h3','Арчилгааны жижиг деталиуд'));paragraphs(c,r.grooming)});
 block('06 / Хувцаслалт',c=>paragraphs(c,r.wardrobe));block('07 / Зураг авах зөвлөгөө',c=>paragraphs(c,r.photoTips));
 block('08 / Чиний төсөв',c=>{let total=0;for(const x of r.budget){item(c,x.item,x.reason,x.costMnt.toLocaleString('en-US')+'₮');total+=x.costMnt;}c.append(make('h3','Нийт: '+total.toLocaleString('en-US')+'₮'));c.append(make('h3','Мөнгө үрэх шаардлагагүй'));paragraphs(c,r.avoidSpending)});
 block('09 / 30 хоногийн төлөвлөгөө',c=>{r.weeks.forEach((w,i)=>{const d=make('div',undefined,'section');d.append(make('h3',`${i+1}-р долоо хоног · ${w.title}`));for(const t of w.tasks){const label=make('label',undefined,'check');const input=make('input');input.type='checkbox';label.append(input,make('span',t));d.append(label)}c.append(d)})});
 block('10 / Мэдээллийн хязгаарлалт',c=>paragraphs(c,r.limitations));window.scrollTo({top:0,behavior:'smooth'});
}
async function compress(file){const bitmap=await createImageBitmap(file);const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.78));if(!blob)throw Error('Зургийг боловсруулахад алдаа гарлаа');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob)});return {mimeType:'image/jpeg',data:base64};}
$('form').onsubmit=async e=>{e.preventDefault();$('error').classList.add('hidden');if(state.photos.some(x=>!x)){showError('3 зургаа бүгдийг оруулна уу.');return}const btn=$('submit');btn.disabled=true;btn.textContent='Зургийг шинжилж байна… (20–60 сек)';try{const images=await Promise.all(state.photos.map(compress));const res=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adult:$('adult').checked,consent:$('consent').checked,answers:{care:$('care').value,hair:$('hair').value,budget:Number($('budget').value),roast:$('roast').value},images:images.map((im,i)=>({...im,label:['FRONT','SIDE','FULL'][i]}))})});const body=await res.json();if(!res.ok)throw Error(body.error||'Тайлан үүсгэхэд алдаа гарлаа');reportId=body.reportId;rememberReport(reportId);renderPreview(body.preview)}catch(err){showError(err.message)}finally{btn.disabled=false;btn.textContent='Миний тайланг гаргах →'}};
function showError(msg){$('error').textContent=msg;$('error').classList.remove('hidden')}
$('restart').onclick=()=>{viewVersion++;rememberReport(null);reportId=null;$('sections').replaceChildren();$('result').classList.add('hidden');$('form').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})};


async function paymentRequest(path, options = {}) {
 const version=viewVersion;
 const btn=$(path==='payment'?'pay':'checkPayment');btn.disabled=true;
 try {
  const response=await fetch('/api/'+path+(path==='report'?'?id='+encodeURIComponent(reportId):''),{
   credentials:'same-origin',cache:'no-store',...options
  });
  const body=await response.json();
  if(version!==viewVersion)return;
  if(!response.ok)throw Error(body.error||'Дахин оролдоно уу.');
  if(path==='report')render(body.report);
 }catch(error){$('paymentStatus').textContent=error.message}
 finally{btn.disabled=false}
}
$('pay').onclick=()=>paymentRequest('payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportId})});
$('checkPayment').onclick=()=>paymentRequest('report');

// Recovery stores only the opaque ID; the server cookie remains mandatory.
const recoveryReady=recoverReport();
