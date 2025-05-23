if (!navigator.bluetooth) {
  Array.prototype.forEach.call(document.getElementsByTagName('button'), (e) => e.hidden = true);
  document.getElementById('ios-ble-support').hidden = false;
  return;
}