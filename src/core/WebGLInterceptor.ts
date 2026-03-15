/**
 * WebGL Interceptor v2 — injected BEFORE game scripts to limit GPU memory.
 *
 * Overrides 10+ browser APIs to enforce memory limits:
 * - texImage2D / compressedTexImage2D: downscale textures
 * - renderbufferStorage: cap dimensions
 * - canvas resolution + devicePixelRatio
 * - Image() constructor: downscale before game uses them
 * - fetch/XHR: track resource transfer sizes
 * - WebAssembly.Memory: cap WASM heap
 * - requestAnimationFrame: throttle FPS
 * - AudioContext.decodeAudioData: downsample buffers
 */

export interface InterceptorConfig {
  maxTextureSize: number;
  maxCanvasWidth: number;
  maxCanvasHeight: number;
  maxDevicePixelRatio: number;
  maxFps: number;
  maxImageSize: number;
  maxWasmMemoryMB: number;
  audioSampleRate: number;
  enableAllocationTracking: boolean;
  reportIntervalMs: number;
}

export const DEFAULT_INTERCEPTOR_CONFIG: InterceptorConfig = {
  maxTextureSize: 1024,
  maxCanvasWidth: 1280,
  maxCanvasHeight: 720,
  maxDevicePixelRatio: 1,
  maxFps: 30,
  maxImageSize: 1024,
  maxWasmMemoryMB: 256,
  audioSampleRate: 22050,
  enableAllocationTracking: true,
  reportIntervalMs: 5000,
};

export function buildInterceptorScript(config: InterceptorConfig = DEFAULT_INTERCEPTOR_CONFIG): string {
  return `(function(){
var C=${JSON.stringify(config)};
var A={tex:0,comp:0,rb:0,img:0,wasm:0,audio:0,fetch:0};
var S={texCount:0,compCount:0,downscaled:0,fetchCount:0,fetchBytes:0,imgCount:0,wasmPages:0,audioBuffers:0,rAfSkipped:0};

// === 1. devicePixelRatio ===
if(C.maxDevicePixelRatio<(window.devicePixelRatio||1)){
  Object.defineProperty(window,'devicePixelRatio',{get:function(){return C.maxDevicePixelRatio},configurable:true});
}

// === 2. Canvas resolution cap ===
var _gCtx=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(t,a){
  if(t==='webgl'||t==='webgl2'||t==='experimental-webgl'){
    var cv=this;
    if(cv.width>C.maxCanvasWidth)cv.width=C.maxCanvasWidth;
    if(cv.height>C.maxCanvasHeight)cv.height=C.maxCanvasHeight;
    var wd=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width');
    var hd=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'height');
    if(wd&&wd.set)Object.defineProperty(cv,'width',{get:function(){return wd.get.call(cv)},set:function(v){wd.set.call(cv,Math.min(v,C.maxCanvasWidth))},configurable:true});
    if(hd&&hd.set)Object.defineProperty(cv,'height',{get:function(){return hd.get.call(cv)},set:function(v){hd.set.call(cv,Math.min(v,C.maxCanvasHeight))},configurable:true});
  }
  return _gCtx.apply(this,arguments);
};

// === 3. Image downscaler utility ===
function dsImg(src,mx){
  if(!src)return src;
  var w=src.width||src.videoWidth||(src instanceof ImageData?src.width:0);
  var h=src.height||src.videoHeight||(src instanceof ImageData?src.height:0);
  if(w<=mx&&h<=mx)return src;
  var s=Math.min(mx/w,mx/h),nw=Math.round(w*s),nh=Math.round(h*s);
  var oc=document.createElement('canvas');oc.width=nw;oc.height=nh;
  var ctx=oc.getContext('2d');if(!ctx)return src;
  ctx.drawImage(src,0,0,nw,nh);
  S.downscaled++;
  return oc;
}

function texBytes(w,h,fmt,gl){
  var b=4;
  if(gl){switch(fmt){case gl.ALPHA:case gl.LUMINANCE:b=1;break;case gl.LUMINANCE_ALPHA:b=2;break;case gl.RGB:b=3;break;}}
  return w*h*b;
}

// === 4. WebGL overrides ===
function patchGL(P){
  // texImage2D
  var _tI=P.texImage2D;
  P.texImage2D=function(){
    var a=[].slice.call(arguments);
    if(a.length>=9){
      var w=a[3],h=a[4];
      if(w>C.maxTextureSize||h>C.maxTextureSize){
        var s=Math.min(C.maxTextureSize/w,C.maxTextureSize/h);
        a[3]=Math.round(w*s);a[4]=Math.round(h*s);
        if(a[8]&&a[8].buffer)a[8]=null;
        S.downscaled++;
      }
      A.tex+=texBytes(a[3],a[4],a[2],this);S.texCount++;
    }else if(a.length>=6){
      var src=a[5];
      if(src&&(src instanceof HTMLImageElement||src instanceof HTMLCanvasElement||src instanceof ImageBitmap||src instanceof HTMLVideoElement)){
        a[5]=dsImg(src,C.maxTextureSize);
        if(a[5]){A.tex+=texBytes(a[5].width||0,a[5].height||0,a[2],this);S.texCount++;}
      }
    }
    return _tI.apply(this,a);
  };

  // compressedTexImage2D — critical for ASTC/ETC2/S3TC compressed textures
  if(P.compressedTexImage2D){
    var _cTI=P.compressedTexImage2D;
    P.compressedTexImage2D=function(){
      var a=[].slice.call(arguments);
      if(a.length>=7){
        var w=a[3],h=a[4];
        if(w>C.maxTextureSize||h>C.maxTextureSize){
          var s=Math.min(C.maxTextureSize/w,C.maxTextureSize/h);
          a[3]=Math.round(w*s);a[4]=Math.round(h*s);
          var ratio=(a[3]*a[4])/(w*h);
          if(a[6]&&typeof a[6]==='number')a[6]=Math.round(a[6]*ratio);
          if(a[6]&&a[6].buffer){
            var newLen=Math.round(a[6].byteLength*ratio);
            a[6]=new Uint8Array(a[6].buffer,a[6].byteOffset,Math.min(newLen,a[6].byteLength));
          }
          S.downscaled++;
        }
        A.comp+=(a[3]*a[4]);S.compCount++;
      }
      return _cTI.apply(this,a);
    };
  }

  // compressedTexSubImage2D
  if(P.compressedTexSubImage2D){
    var _cTSI=P.compressedTexSubImage2D;
    P.compressedTexSubImage2D=function(){
      var a=[].slice.call(arguments);
      if(a.length>=7){
        if(a[4]>C.maxTextureSize)a[4]=C.maxTextureSize;
        if(a[5]>C.maxTextureSize)a[5]=C.maxTextureSize;
      }
      return _cTSI.apply(this,a);
    };
  }

  // renderbufferStorage
  var _rBS=P.renderbufferStorage;
  P.renderbufferStorage=function(t,f,w,h){
    var cw=Math.min(w,C.maxTextureSize),ch=Math.min(h,C.maxTextureSize);
    A.rb+=cw*ch*4;
    return _rBS.call(this,t,f,cw,ch);
  };

  // deleteTexture tracking
  var _dT=P.deleteTexture;
  P.deleteTexture=function(tex){
    if(tex)S.texCount=Math.max(0,S.texCount-1);
    return _dT.apply(this,arguments);
  };
}

if(typeof WebGLRenderingContext!=='undefined')patchGL(WebGLRenderingContext.prototype);
if(typeof WebGL2RenderingContext!=='undefined')patchGL(WebGL2RenderingContext.prototype);

// === 5. Image() constructor proxy ===
var _Img=window.Image;
window.Image=function(w,h){
  var img=new _Img(w,h);
  var _srcDesc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')||Object.getOwnPropertyDescriptor(img.__proto__,'src');
  if(_srcDesc&&_srcDesc.set){
    var origSet=_srcDesc.set;
    Object.defineProperty(img,'src',{
      get:function(){return _srcDesc.get?_srcDesc.get.call(img):''},
      set:function(v){
        origSet.call(img,v);
        S.imgCount++;
      },
      configurable:true
    });
  }
  img.addEventListener('load',function(){
    if(img.naturalWidth>C.maxImageSize||img.naturalHeight>C.maxImageSize){
      A.img+=img.naturalWidth*img.naturalHeight*4;
    }else{
      A.img+=(img.naturalWidth||0)*(img.naturalHeight||0)*4;
    }
  });
  return img;
};
window.Image.prototype=_Img.prototype;

// === 6. fetch() interception ===
var _fetch=window.fetch;
window.fetch=function(){
  S.fetchCount++;
  return _fetch.apply(this,arguments).then(function(resp){
    var cl=resp.headers.get('content-length');
    if(cl)S.fetchBytes+=parseInt(cl,10)||0;
    A.fetch+=parseInt(cl,10)||0;
    return resp;
  });
};

// === 7. XMLHttpRequest interception ===
var _xhrOpen=XMLHttpRequest.prototype.open;
var _xhrSend=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(){
  this._shieldUrl=(arguments[1]||'').toString();
  return _xhrOpen.apply(this,arguments);
};
XMLHttpRequest.prototype.send=function(){
  var xhr=this;
  S.fetchCount++;
  xhr.addEventListener('load',function(){
    var len=0;
    try{len=parseInt(xhr.getResponseHeader('content-length'),10)||0;}catch(e){}
    if(!len&&xhr.response){len=xhr.response.byteLength||xhr.response.length||0;}
    S.fetchBytes+=len;
    A.fetch+=len;
  });
  return _xhrSend.apply(this,arguments);
};

// === 8. WebAssembly.Memory limiting ===
if(typeof WebAssembly!=='undefined'&&WebAssembly.Memory){
  var _WasmMem=WebAssembly.Memory;
  var maxPages=Math.floor(C.maxWasmMemoryMB*1024*1024/65536);
  WebAssembly.Memory=function(desc){
    if(desc.maximum&&desc.maximum>maxPages)desc.maximum=maxPages;
    if(desc.initial&&desc.initial>maxPages)desc.initial=maxPages;
    S.wasmPages=desc.initial||0;
    A.wasm=S.wasmPages*65536;
    return new _WasmMem(desc);
  };
  WebAssembly.Memory.prototype=_WasmMem.prototype;
}

// === 9. requestAnimationFrame throttling ===
if(C.maxFps>0&&C.maxFps<60){
  var _rAF=window.requestAnimationFrame;
  var interval=1000/C.maxFps;
  var lastFrame=0;
  window.requestAnimationFrame=function(cb){
    return _rAF.call(window,function(ts){
      if(ts-lastFrame>=interval){
        lastFrame=ts;
        cb(ts);
      }else{
        S.rAfSkipped++;
        _rAF.call(window,cb);
      }
    });
  };
}

// === 10. AudioContext buffer interception ===
if(typeof AudioContext!=='undefined'||typeof webkitAudioContext!=='undefined'){
  var AC=typeof AudioContext!=='undefined'?AudioContext:webkitAudioContext;
  var _decodeAudio=AC.prototype.decodeAudioData;
  AC.prototype.decodeAudioData=function(buf,success,error){
    var ctx=this;
    S.audioBuffers++;
    A.audio+=buf.byteLength;
    return _decodeAudio.call(ctx,buf,function(decoded){
      if(decoded.sampleRate>C.audioSampleRate&&typeof OfflineAudioContext!=='undefined'){
        try{
          var ch=decoded.numberOfChannels;
          var dur=decoded.duration;
          var newLen=Math.round(dur*C.audioSampleRate);
          var oc=new OfflineAudioContext(ch,newLen,C.audioSampleRate);
          var src=oc.createBufferSource();
          src.buffer=decoded;
          src.connect(oc.destination);
          src.start(0);
          oc.startRendering().then(function(down){
            if(success)success(down);
          }).catch(function(){
            if(success)success(decoded);
          });
        }catch(e){
          if(success)success(decoded);
        }
      }else{
        if(success)success(decoded);
      }
    },error);
  };
}

// === 11. Reporting ===
if(C.enableAllocationTracking&&C.reportIntervalMs>0){
  setInterval(function(){
    var total=0;for(var k in A)total+=A[k];
    window.parent.postMessage({
      type:'webgl-interceptor-report',
      data:{
        totalAllocatedMB:Math.round(total/1048576),
        breakdown:{
          texturesMB:Math.round(A.tex/1048576),
          compressedMB:Math.round(A.comp/1048576),
          renderbuffersMB:Math.round(A.rb/1048576),
          imagesMB:Math.round(A.img/1048576),
          wasmMB:Math.round(A.wasm/1048576),
          audioMB:Math.round(A.audio/1048576),
          fetchMB:Math.round(A.fetch/1048576)
        },
        stats:{
          textureCount:S.texCount,
          compressedCount:S.compCount,
          downscaledCount:S.downscaled,
          fetchRequests:S.fetchCount,
          fetchTotalMB:Math.round(S.fetchBytes/1048576),
          imageCount:S.imgCount,
          wasmPages:S.wasmPages,
          audioBuffers:S.audioBuffers,
          rAfFramesSkipped:S.rAfSkipped
        },
        config:{
          maxTextureSize:C.maxTextureSize,
          maxCanvasSize:C.maxCanvasWidth+'x'+C.maxCanvasHeight,
          maxFps:C.maxFps,
          dpr:window.devicePixelRatio,
          maxWasmMB:C.maxWasmMemoryMB,
          audioRate:C.audioSampleRate
        }
      }
    },'*');
  },C.reportIntervalMs);
}

console.log('[iframe-shield v1.1] Interceptor active: tex='+C.maxTextureSize+' canvas='+C.maxCanvasWidth+'x'+C.maxCanvasHeight+' fps='+C.maxFps+' dpr='+C.maxDevicePixelRatio+' wasm='+C.maxWasmMemoryMB+'MB audio='+C.audioSampleRate+'Hz');
})();`;
}
