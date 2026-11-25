import { write } from '@mapbox/shp-write';
import JSZip from 'jszip';
import { rewind } from '@turf/turf';
import type { FeatureCollection,Geometry,GeoJsonProperties } from 'geojson';

type ShapeKind='POINT'|'POLYLINE'|'POLYGON';
type Part={coords:object,props:NonNullable<GeoJsonProperties>};
const projection='GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';

// DBF field widths count bytes. Keep multilingual strings on UTF-8 boundaries.
function attributes(rows:Part[]){
 const encoder=new TextEncoder();
 const fields=[['event_id','id'],['layer','type'],['title','title'],['utc','timestamp'],['value','severity'],['confidence','confidence'],['source','source'],['source_url','source_url'],['country','country']].map(([name,key])=>{
   const numeric=key==='severity';
   let width=numeric?20:1;
   if(!numeric)for(const {props} of rows)width=Math.max(width,Math.min(254,encoder.encode(String(props[key]??'')).length));
   return {name,key,numeric,width};
 });
 const header=33+32*fields.length,record=1+fields.reduce((n,f)=>n+f.width,0);
 const bytes=new Uint8Array(header+record*rows.length+1),v=new DataView(bytes.buffer),now=new Date();
 bytes.set([3,now.getUTCFullYear()-1900,now.getUTCMonth()+1,now.getUTCDate()],0);
 v.setUint32(4,rows.length,true);v.setUint16(8,header,true);v.setUint16(10,record,true);
 fields.forEach((f,i)=>{const pos=32+i*32;bytes.set(encoder.encode(f.name),pos);bytes[pos+11]=f.numeric?78:67;bytes[pos+16]=f.width;bytes[pos+17]=f.numeric?6:0;});
 bytes[header-1]=13;bytes.fill(32,header);bytes[bytes.length-1]=26;
 rows.forEach(({props},i)=>{
   let pos=header+record*i+1;
   for(const f of fields){
     const value=props[f.key];
     if(value!=null){
       const text=f.numeric?Number(value).toFixed(6).padStart(f.width):String(value);
       encoder.encodeInto(text,bytes.subarray(pos,pos+f.width));
     }
     pos+=f.width;
   }
 });
 return bytes;
}
export async function shapeArchive(data:FeatureCollection){
 const zip=new JSZip(),groups:Record<ShapeKind,Part[]>={POINT:[],POLYLINE:[],POLYGON:[]};
 function append(g:Geometry,props:NonNullable<GeoJsonProperties>){
   switch(g.type){
     case 'Point':groups.POINT.push({coords:g.coordinates,props});break;
     case 'MultiPoint':for(const coords of g.coordinates)groups.POINT.push({coords,props});break;
     case 'LineString':groups.POLYLINE.push({coords:[g.coordinates],props});break;
     case 'MultiLineString':groups.POLYLINE.push({coords:g.coordinates,props});break;
     case 'Polygon':groups.POLYGON.push({coords:g.coordinates,props});break;
     case 'MultiPolygon':groups.POLYGON.push({coords:g.coordinates.flat(),props});break;
     case 'GeometryCollection':for(const part of g.geometries)append(part,props);
   }
 }
 const copy=structuredClone(data);rewind(copy,{reverse:true,mutate:true});
 for(const f of copy.features)append(f.geometry,f.properties||{});
 for(const kind of Object.keys(groups) as ShapeKind[]){
   const rows=groups[kind];if(!rows.length)continue;
   const prefix='gulfhazard/'+kind;
   write(rows.map(()=>({})),kind,rows.map(p=>p.coords),(err,files)=>{
     if(err)throw err;
     zip.file(prefix+'.shp',files.shp.buffer);zip.file(prefix+'.shx',files.shx.buffer);
   });
   zip.file(prefix+'.dbf',attributes(rows));zip.file(prefix+'.prj',projection);zip.file(prefix+'.cpg','UTF-8');
 }
 return zip.generateAsync({type:'blob',compression:'DEFLATE'});
}
