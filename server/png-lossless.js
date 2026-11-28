// Repack only the zlib stream. PNG scanlines, metadata, dimensions and pixels stay unchanged.
import {promisify} from 'node:util';
import {inflate,deflate} from 'node:zlib';
const unzip=promisify(inflate),zip=promisify(deflate);
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const MAX_INPUT=8*1024*1024,MAX_RAW=32*1024*1024;
export function pngCrc32(buffer){let c=0xffffffff;for(const n of buffer){c^=n;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
export async function optimizePngLossless(original){
 try{
  if(!Buffer.isBuffer(original)||original.length>MAX_INPUT||!original.subarray(0,8).equals(SIGNATURE))return original;
  const chunks=[],ids=[];let at=8,ended=false,idEnded=false,sawId=false;
  while(at<original.length){
   if(at+12>original.length)return original;
   const length=original.readUInt32BE(at),end=at+length+12;
   if(end>original.length)return original;
   const type=original.toString('ascii',at+4,at+8),chunk=original.subarray(at,end);
   if(!/^[A-Za-z]{4}$/.test(type)||pngCrc32(chunk.subarray(4,-4))!==chunk.readUInt32BE(chunk.length-4))return original;
   if(!chunks.length&&(type!=='IHDR'||length!==13))return original;
   if(['acTL','fcTL','fdAT'].includes(type))return original; // do not rewrite animated PNGs
   if(type==='IDAT'){if(idEnded)return original;ids.push(chunk.subarray(8,-4));sawId=true;}
   else if(sawId)idEnded=true;
   chunks.push({type,chunk});at=end;
   if(type==='IEND'){if(length||at!==original.length)return original;ended=true;break;}
  }
  if(!ended||!ids.length)return original;
  const raw=await unzip(Buffer.concat(ids),{maxOutputLength:MAX_RAW});
  const compressed=await zip(raw,{level:9});
  if(compressed.length>=ids.reduce((n,b)=>n+b.length,0))return original;
  const roundtrip=await unzip(compressed,{maxOutputLength:MAX_RAW});
  if(!raw.equals(roundtrip))return original;
  const packed=Buffer.alloc(compressed.length+12);packed.writeUInt32BE(compressed.length);packed.write('IDAT',4);compressed.copy(packed,8);packed.writeUInt32BE(pngCrc32(packed.subarray(4,-4)),packed.length-4);
  const output=[SIGNATURE];let inserted=false;
  for(const {type,chunk}of chunks){if(type==='IDAT'){if(!inserted)output.push(packed);inserted=true;}else output.push(chunk);}
  const result=Buffer.concat(output);return result.length<original.length?result:original;
 }catch{return original;}
}
