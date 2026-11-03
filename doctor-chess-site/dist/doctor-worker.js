importScripts('/engine.js', '/search.js');
self.onmessage = (e) => {
  const { id, state, options } = e.data;
  try {
    self.postMessage({ id, ...DoctorSearch.search(state, options) });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
