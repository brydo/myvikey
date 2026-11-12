// Browser-side helper shared by the finder page and the owner's test screen.
// Builds contact links from the number; location (if any) never leaves the browser.
export const LINKS_JS = String.raw`
function vkNorm(n){
  var d=String(n).replace(/[\s\-().]/g,'');
  if(d.indexOf('+440')===0)d='+44'+d.slice(4);
  if(d.indexOf('00')===0)return '+'+d.slice(2);
  if(d.charAt(0)==='0')return '+44'+d.slice(1);
  return d;
}
function vkLinks(number,name,kind,loc){
  var num=vkNorm(number);
  var digits=num.replace(/\D/g,'');
  var t='Hi, I have found your '+(kind==='pet'?'pet ':'item ')+name+'.';
  if(loc)t+=' My location: https://maps.google.com/?q='+loc.lat+','+loc.lng;
  var q=encodeURIComponent(t);
  return {call:'tel:'+num,whatsapp:'https://wa.me/'+digits+'?text='+q,sms:'sms:'+num+'?body='+q};
}
`;
