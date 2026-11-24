const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const http=require('http');
const {spawn}=require('child_process');const fs=require('fs'),path=require('path'),crypto=require('crypto');
const SITE='https://potatosalad-san.github.io/Shogi-Analyzer/'; // ← 自分のGitHub PagesのURLに合わせる
const cfg=()=>path.join(app.getPath('userData'),'engine.json');
function rd(){let c={};try{c=JSON.parse(fs.readFileSync(cfg(),'utf8'))}catch(e){}
  if(!c.engines)c.engines=c.path?[{id:crypto.randomUUID(),name:path.basename(c.path).replace(/\.exe$/i,''),path:c.path}]:[];
  if(!c.active||!c.engines.some(e=>e.id===c.active))c.active=c.engines[0]?c.engines[0].id:null;return c}
const wr=c=>fs.writeFileSync(cfg(),JSON.stringify({engines:c.engines,active:c.active}));
let win=null,proc=null,buf='';
const ok=e=>e.senderFrame&&e.senderFrame.url.startsWith(SITE);
const pub=c=>({engines:c.engines.map(e=>({id:e.id,name:e.name})),active:c.active});
function createWindow(){
  win=new BrowserWindow({width:1280,height:860,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ Electron\/[\d.]+/,'').replace(/ shogi-?analyzer\/[\d.]+/i,''));
  win.webContents.on('will-navigate',(ev,url)=>{if(!url.startsWith(SITE)){ev.preventDefault();shell.openExternal(url)}});
  win.webContents.setWindowOpenHandler(({url})=>{shell.openExternal(url);return{action:'deny'}});
  win.setMenuBarVisibility(false);win.loadURL(SITE);
}
ipcMain.handle('eng:list',e=>ok(e)?pub(rd()):{engines:[],active:null});
ipcMain.handle('eng:add',async e=>{if(!ok(e))return null;
  const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'USIエンジン',extensions:['exe']},{name:'すべて',extensions:['*']}]});
  if(r.canceled)return null;const c=rd(),p=r.filePaths[0],id=crypto.randomUUID();
  c.engines.push({id,name:path.basename(p).replace(/\.exe$/i,''),path:p});c.active=id;wr(c);return id});
ipcMain.handle('eng:rename',(e,id,name)=>{if(!ok(e))return;const c=rd(),x=c.engines.find(v=>v.id===id);if(x&&typeof name==='string'){x.name=name.slice(0,60);wr(c)}});
ipcMain.handle('eng:remove',(e,id)=>{if(!ok(e))return;const c=rd();c.engines=c.engines.filter(v=>v.id!==id);wr(c)});
ipcMain.handle('eng:select',(e,id)=>{if(!ok(e))return;const c=rd();if(c.engines.some(v=>v.id===id)){c.active=id;wr(c)}});
ipcMain.handle('eng:start',async e=>{if(!ok(e))return{ok:false,error:'権限がありません'};
  const c=rd(),x=c.engines.find(v=>v.id===c.active);
  if(!x||!fs.existsSync(x.path))return{ok:false,error:'エンジンが未登録か、ファイルが見つかりません。「追加」でエンジンのexeを登録してください'};
  if(proc){try{proc.kill()}catch(_){}}buf='';
  const send=l=>{if(win&&!win.isDestroyed())win.webContents.send('eng:line',l)};
  const p=spawn(x.path,[],{cwd:path.dirname(x.path)});proc=p;
  p.stdout.on('data',d=>{buf+=d.toString();let i;while((i=buf.indexOf('\n'))>=0){send(buf.slice(0,i).replace(/\r$/,''));buf=buf.slice(i+1)}});
  p.stderr.on('data',d=>send('info string stderr '+d.toString().trim()));
  p.on('exit',code=>{send('info string engine exited '+code);if(proc===p)proc=null});
  p.on('error',err=>send('info string spawn error '+err.message));
  return{ok:true,path:x.path,id:x.id,name:x.name}});
ipcMain.on('eng:send',(e,t)=>{if(ok(e)&&proc&&typeof t==='string')proc.stdin.write(t+'\n')});
const b64u=b=>b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
// Googleログイン（シークレット不要）: 既定のブラウザでGoogle認証し、localhost経由でIDトークンだけを受け取る。
// 使うのは公開されても問題のない「ウェブ クライアントID」のみ。秘密情報はアプリにもリポジトリにも含まれない。
const PORT=53682; // Google Cloud の「承認済みのリダイレクト URI」に http://localhost:53682/ を登録しておく
ipcMain.handle('auth:google',(e,clientId)=>{if(!ok(e))return{ok:false,error:'権限がありません'};
  if(typeof clientId!=='string'||!/\.apps\.googleusercontent\.com$/.test(clientId))return{ok:false,error:'クライアントIDが正しくありません'};
  return new Promise(resolve=>{
    const raw=b64u(crypto.randomBytes(24)),nonce=crypto.createHash('sha256').update(raw).digest('hex'),state=b64u(crypto.randomBytes(16));
    let done=false;const fin=r=>{if(done)return;done=true;clearTimeout(tm);srv.close();resolve(r)};
    const srv=http.createServer((req,res)=>{
      if(req.method==='POST'&&req.url==='/cb'){let b='';req.on('data',d=>{b+=d;if(b.length>20000)req.destroy()});
        req.on('end',()=>{res.writeHead(204).end();const q=new URLSearchParams(b);
          if(q.get('state')!==state)return fin({ok:false,error:'state が一致しません'});
          const t=q.get('id_token');if(!t)return fin({ok:false,error:q.get('error')||'トークンを受け取れませんでした'});
          fin({ok:true,idToken:t,rawNonce:raw})});return}
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end('<meta charset="utf-8"><body style="font-family:sans-serif;padding:2em"><h2 id="m">処理中…</h2><script>fetch("/cb",{method:"POST",body:location.hash.slice(1)}).then(function(){document.getElementById("m").textContent="ログインしました。このタブを閉じて、アプリに戻ってください。"})</script>')});
    srv.on('error',x=>fin({ok:false,error:'ポート'+PORT+'を開けません: '+x.message}));
    const tm=setTimeout(()=>fin({ok:false,error:'タイムアウト（3分）'}),180000);
    srv.listen(PORT,'localhost',()=>shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:clientId,redirect_uri:'http://localhost:'+PORT+'/',response_type:'id_token',scope:'openid email profile',nonce,state,prompt:'select_account'})));
  })});
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(proc)proc.kill();app.quit()});
