import type { NearbyFuelStation } from '@/lib/services/googlePlacesAutocomplete';

export interface StationMapProps {
  origin: { latitude: number; longitude: number };
  stations: NearbyFuelStation[];
  onSelect: (placeId: string) => void;
}
export interface StationMapSurfaceProps {
  html: string;
  onMessage: (value: unknown) => void;
  onError: () => void;
}

type MapMessage = { type: 'ready' | 'error' } | { type: 'select'; placeId: string };

export function readStationMapMessage(raw: unknown, channel: string, ids: Set<string>): MapMessage | null {
  let message: unknown = raw;
  if (typeof raw === 'string') {
    try { message = JSON.parse(raw); } catch { return null; }
  }
  if (!message || typeof message !== 'object') return null;
  const value = message as Record<string, unknown>;
  if (value.channel !== channel) return null;
  if (value.type === 'ready' || value.type === 'error') return { type: value.type };
  return value.type === 'select' && typeof value.placeId === 'string' && ids.has(value.placeId)
    ? { type: 'select', placeId: value.placeId } : null;
}

/** Data is serialized as JSON, never interpolated into executable HTML or labels. */
export function createStationMapHtml(config: Omit<StationMapProps, 'onSelect'> & { apiKey: string; mapId: string; channel: string }): string {
  const data = JSON.stringify({ ...config, stations: config.stations.map(({ placeId, name, latitude, longitude }) => ({ placeId, name, latitude, longitude })) })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>Nearby station map</title>
<style>html,body,#map{height:100%;width:100%;padding:0;margin:0;background:#EDF1F4;font-family:Arial,sans-serif}.station-pin{width:40px;height:40px;border-radius:50%;background:#3E5FB5;color:#fff;border:3px solid #fff;box-shadow:0 2px 6px #192d4255;font-size:14px;font-weight:700;cursor:pointer}.station-pin.selected{background:#DCE9B5;color:#192D42;border-color:#192D42}.you{width:16px;height:16px;border:3px solid #fff;border-radius:50%;background:#2563EB;box-shadow:0 0 0 4px #2563eb33}.recenter{background:#fff;border:1px solid #D5DDEB;color:#192D42;border-radius:10px;min-height:40px;padding:0 12px;margin:10px;font:600 12px Arial;cursor:pointer}</style></head><body><div id="map" role="region" aria-label="Google Maps nearby fuel stations"></div><script>
(function(){
  var config=${data};
  function send(type,id){var message={type:type,channel:config.channel};if(id)message.placeId=id;
    if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else window.parent.postMessage(message,'*');
  }
  var timeout=setTimeout(function(){send('error');},15000);
  window.gm_authFailure=function(){clearTimeout(timeout);send('error');};
  window.initStationMap=async function(){try{
    var maps=await google.maps.importLibrary('maps');
    var markers=await google.maps.importLibrary('marker');
    var origin={lat:config.origin.latitude,lng:config.origin.longitude};
    var map=new maps.Map(document.getElementById('map'),{center:origin,zoom:14,mapId:config.mapId,disableDefaultUI:true,zoomControl:true,clickableIcons:false,gestureHandling:'greedy'});
    var user=document.createElement('div');user.className='you';user.setAttribute('aria-label','Your location');
    new markers.AdvancedMarkerElement({map:map,position:origin,title:'Your location',content:user});
    var bounds=new google.maps.LatLngBounds();bounds.extend(origin);
    var pins=[];
    config.stations.forEach(function(station,index){
      var pin=document.createElement('button');pin.type='button';pin.className='station-pin';pin.textContent=String(index+1);pin.setAttribute('aria-label','Select '+station.name);
      var position={lat:station.latitude,lng:station.longitude};bounds.extend(position);
      var marker=new markers.AdvancedMarkerElement({map:map,position:position,title:station.name,content:pin});
      function select(){pins.forEach(function(p){p.classList.remove('selected');});pin.classList.add('selected');map.panTo(position);send('select',station.placeId);}
      pin.addEventListener('click',select);marker.addListener('click',select);pins.push(pin);
    });
    if(config.stations.length){map.fitBounds(bounds,48);google.maps.event.addListenerOnce(map,'idle',function(){if(map.getZoom()>16)map.setZoom(16);});}
    var recenter=document.createElement('button');recenter.type='button';recenter.className='recenter';recenter.textContent='My location';recenter.addEventListener('click',function(){map.panTo(origin);map.setZoom(14);});map.controls[google.maps.ControlPosition.TOP_LEFT].push(recenter);
    clearTimeout(timeout);send('ready');
  }catch(error){clearTimeout(timeout);send('error');}};
  var script=document.createElement('script');script.async=true;script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(config.apiKey)+'&v=weekly&loading=async&libraries=marker&callback=initStationMap';script.onerror=function(){clearTimeout(timeout);send('error');};document.head.appendChild(script);
})();
</script></body></html>`;
}
