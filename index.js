'use strict';

var dns = require('dns');
var net = require('net');
var promisify = require('js-promisify');

// Helper to validate email based on regex
const EMAIL_REGEX = /^([\w-]+(?:\.[\w-]+)*)@((?:[\w-]+\.)*\w[\w-]{0,66})\.([a-z]{2,6}(?:\.[a-z]{2})?)$/i;
const LOG_FLAG = false

function validateEmail (email) {
  if (typeof email === 'string' && email.length > 5 && email.length < 61 && EMAIL_REGEX.test(email)) {
    return email.toLowerCase();
  } else {
    return false;
  }
}

// Full email check
module.exports = function (email, opts) {
  return new Promise(function (resolve, reject) {
    email = validateEmail(email);
    email ? resolve(email.split('@')[1]) : reject();
  })
  .then(function (domain) {
    return promisify(dns.resolveMx, [domain]);
  })
  .catch(function (err) {
    throw(new Error('wrong'));
  })
  .then(function (addresses) {
    if (addresses.length === 1) {
      return addresses[0].exchange;
    } else {
      // Find the lowest priority mail server
      // var lowestPriorityIndex = 0;
      // var lowestPriority = addresses[0].priority;
      // for (var i = 1; i < addresses.length; i++) {
      //   var currentPriority = addresses[i].priority;
      //   if (currentPriority < lowestPriority) {
      //     lowestPriority = currentPriority;
      //     lowestPriorityIndex = i;
      //   }
      // }
      // return addresses[lowestPriorityIndex].exchange;
      // Get all addresses's exchanges
      var exchanges = []
      for (var i = 0; i < addresses.length; i++) {
        exchanges.push(addresses[i].exchange)
      }
      return exchanges
    }
  })
  .then(function (addresses) {
    opts = opts || {};
    var options = {
      from: validateEmail(opts.from) || email,
      timeout: opts.timeout || 5000
    };
    options.host = opts.host || options.from.split('@')[1];
    // NOTE: \r\n is more compitable than \n
    const end = '\r\n'
    const COMM = [
      'HELO ' + options.host + end,
      'MAIL FROM: <' + options.from + '>' + end,
      'RCPT TO: <' + email + '>' + end
    ];
    var ps = []
    for(var i = 0; i < addresses.length; i++){
      var address = addresses[i]
      var pFunc = ((address) => new Promise(function (resolve, reject) {
        var step = 0;
        
        log('trying:' + address)
        var socket = net.createConnection(25, address);
        socket.setTimeout(options.timeout, function () {
          var errorMessage = 'timeout after ' + options.timeout + ' for ' + address
          log(errorMessage)
          socket.destroy();
          reject( new Error(errorMessage));
        });
        socket.on('data', function (data) {
          log(data.toString())
          if (data.toString()[0] !== '2') {
            socket.destroy();
            reject(new Error('Not 2xx return in last message:' + data.toString()));
          }
          if (step < 3) {
            socket.write(COMM[step], function () {
              step++;
            });
          } else {
            socket.destroy();
            resolve({status: true, error: null});
          }
        });
        socket.on('error', function (err) {
          log('socket error callback:')
          log(JSON.stringify(err))
          socket.destroy();
          if (err.code === 'ECONNRESET') {
            reject(new Error('refuse: ' + err.code));
          } else {
            reject(err);
          }
        })
      })).bind(this, address)

      ps.push( pFunc )
    }
    log('After structured all promises')
    // Check against all exchange servers until find a match or return error when all servers say it invalid 
    return ps.reduce(function(prev, current, index){
      return prev.then(function(res){
        if(res.status === true){
          log(index + '->skip current')
          return Promise.resolve({status: true, error: null})
        }
        log(index + '->checking current')
        return current()
      }).catch(function(err){
        return Promise.resolve({status: false, error: err})
      })
    }, Promise.resolve({status: false, error: null}));
    
  })
  .catch(function (err) {
    if (err.message === 'wrong') {
      return false;
    } else {
      throw err;
    }
  })
};

function log(message){
  if(LOG_FLAG){
    console.log(message)
  }
}
