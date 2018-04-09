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
module.exports = {
  validateSingleMxByPriority: function (email, opts) {
    return new Promise(function (resolve, reject) {
      email = validateEmail(email);
      email ? resolve(email.split('@')[1]) : reject({status: false, mx: null, error: 'email format is invalid'});
    })
      .catch(function (err) {
        if (err) {
          return { status: false, mx: err['mx'], error: err['error'] };
        } else {
          throw err;
        }
      })
      .then(function (domain) {
        return promisify(dns.resolveMx, [domain]);
      })
      .catch(function (err) {
        if (err) {
          return {status: false, mx: err['mx'], error: err['message']};
        } else {
          throw err;
        }
      })
      .then(function (addresses) {
        if (addresses.length === 1) {
          return addresses[0].exchange;
        } else {
          // Find the lowest priority mail server
          var lowestPriorityIndex = 0;
          var lowestPriority = addresses[0].priority;
          for (var i = 1; i < addresses.length; i++) {
            var currentPriority = addresses[i].priority;
            if (currentPriority < lowestPriority) {
              lowestPriority = currentPriority;
              lowestPriorityIndex = i;
            }
          }
          return addresses[lowestPriorityIndex].exchange;
        }
      })
      .then(function (address) {
        opts = opts || {};
        var options = {
          from: validateEmail(opts.from) || email,
          timeout: opts.timeout || 5000
        };
        options.host = opts.host || options.from.split('@')[1];
        var step = 0;
        const COMM = [
          'helo ' + options.host + '\r\n',
          'mail from:<' + options.from + '>\r\n',
          'rcpt to:<' + email + '>\r\n'
        ];
        return new Promise(function (resolve, reject) {
          var socket = net.createConnection(25, address);
          socket.setTimeout(options.timeout, function () {
            var errorMessage = 'timeout after ' + options.timeout + ' for ' + address
            log(errorMessage)
            socket.destroy();
            reject({mx: address, error: new Error(errorMessage)});
          });
          socket.on('close', function(data){
            socket.destroy();
            reject({mx: address, error: new Error(`Server ${address} closed:` + data.toString())});
          })
          socket.on('data', function (data) {
            let response = data.toString()
            log(response)
            if (response[0] !== '2') {
              socket.destroy();
              reject({mx: address, error: new Error('Not 2xx return in last message:' + response)});
            }
            if (step < 3) {
              socket.write(COMM[step], function () {
                step++;
              });
            } else {
              socket.destroy();
              resolve({status: true, mx: address, error: null});
            }
          });
          socket.on('error', function (err) {
            log('socket error callback:')
            log(JSON.stringify(err))
            socket.destroy();
            if (err.code === 'ECONNRESET') {
              reject({mx: address, error: new Error('refuse')});
            } else {
              reject({mx: address, error: err});
            }
          })
        });
      })
      .catch(function (err) {
        if (err) {
          return {status: false, mx: err['mx'], error: err['error'] || err['message']};
        } else {
          throw err;
        }
      })
  },

  validateAllMx: function (email, opts) {
    return new Promise(function (resolve, reject) {
      email = validateEmail(email);
      if(email){
        resolve(email.split('@')[1]) 
      } else {
        reject({status: false, mx: null, error: 'email format is invalid'});
      }
    })
    .then(function (domain) {
      return promisify(dns.resolveMx, [domain]);
    })
    .catch(function (err) {
      throw(err);
    })
    .then(function (addresses) {
      if (addresses.length === 1) {
        return [addresses[0].exchange];
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
    .then(function (MXAddresses) {
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
      for(var i = 0; i < MXAddresses.length; i++){
        var MXAddress = MXAddresses[i]
        var pFunc = ((MXAddress) => new Promise(function (resolve, reject) {
          var step = 0;
          
          log('Checking MX:' + MXAddress)
          var socket = net.createConnection(25, MXAddress);
          socket.setTimeout(options.timeout, function () {
            var errorMessage = 'timeout after ' + options.timeout + ' for ' + MXAddress
            log(errorMessage)
            socket.destroy();
            reject( new Error(errorMessage));
          });
          socket.on('close', function(data){
            socket.destroy();
            reject(new Error(`Server ${MXAddress} closed:` + data.toString()));
          })
          socket.on('data', function (data) {
            let response = data.toString()
            log(response)
            if (response[0] !== '2') {
              socket.destroy();
              reject(new Error('Not 2xx return in last message:' + response));
            }
            if (step < 3) {
              socket.write(COMM[step], function () {
                step++;
              });
            } else {
              socket.destroy();
              resolve({status: true, mx: MXAddress, error: null});
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
        })).bind(this, MXAddress)
  
        ps.push( pFunc )
      }
      log('After structured all promises')
      // Check against all exchange servers until find a match or return error when all servers say it invalid 
      return ps.reduce(function(prev, current, index){
        return prev.then(function(res){
          if(res['status'] === true){
            log(index + '->skip current')
            return Promise.resolve({status: true, mx: res['mx'], error: null})
          }
          log(index + '->checking current')
          return current()
        }).catch(function(err){
          return Promise.resolve({status: false, mx: null, error: err})
        })
      }, Promise.resolve({status: false, mx: null, error: null}));
      
    })
    .catch(function (err) {
      if (err) {
        return {status: false, mx: null, error: err};
      } else {
        throw err;
      }
    })
  }
}



function log(message){
  if(LOG_FLAG){
    console.log(message)
  }
}
