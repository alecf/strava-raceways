// Create an XHR context that fires off progress notifications
// usage:
// function update_progress(waiting, total) {
//   console.log("Updated ", waiting, " / ", total);
// }
// var XHR = xhrContext(update_progress);
// XHR('http://....).then(function(result)) {... });
function XHRContext(progress) {
    var total_started = 0;
    var total_complete = 0;

    function update_progress() {
        progress(total_started, total_complete);
        if (total_started == total_complete)
            total_started = total_complete = 0;
    }

    return function(url, params) {
        total_started += 1;
        progress(total_started, total_complete);
        var xhr = new XMLHttpRequest();
        if (params) {
            var p = [];
            for (var key in params) {
                var value = params[key] || '';
                p.push(encodeURIComponent(key) + '=' +
                       encodeURIComponent(value));
            }
            url += '?' + p.join('&');
        }
        var p = new Promise(function(resolve, reject) {
            try {
                LASTXHR = xhr;
                xhr.open('GET', url, true);
                xhr.onload = function() {
                    // console.error("Got response from ", url, ": ", xhr.responseText);
                    try {
                        var response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch(ex) {
                        console.trace(ex, " in ", xhr.responseText);
                        reject(ex);
                    }
                    total_complete += 1;
                    update_progress();
                };
                xhr.onloadend = function(e) {
                    total_complete += 1;
                    update_progress();
                    reject(e);
                };
                //console.log("Requesting ", url);
                xhr.send();
            } catch (ex) {
                total_complete +=1;
                update_progress();
                reject(ex);
            };
        });
        p.request = xhr;
        return p;
    };
}
