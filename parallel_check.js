'use strict';

var dns = require('dns');
var net = require('net');
var promisify = require('js-promisify');

// Helper to validate email based on regex
const EMAIL_REGEX = /^([\w-]+(?:\.[\w-]+)*)@((?:[\w-]+\.)*\w[\w-]{0,66})\.([a-z]{2,6}(?:\.[a-z]{2})?)$/i;

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
        var lowestPriorityIndex = 0;
        var lowestPriority = addresses[0].priority;
        for (var i = 1; i < addresses.length; i++) {
          var currentPriority = addresses[i].priority;
          if (currentPriority < lowestPriority) {
            lowestPriority = currentPriority;
            lowestPriorityIndex = i;
          }
        }
        // Get all addresses's exchanges
        var exchanges = []
        for (var i = 0; i < addresses.length; i++) {
          exchanges.push(addresses[i].exchange)
        }
        return exchanges
        // return addresses[lowestPriorityIndex].exchange;
      }
    })
    .then(function (addresses) {
      opts = opts || {};
      var options = {
        from: validateEmail(opts.from) || email,
        timeout: opts.timeout || 5000
      };
      options.host = opts.host || options.from.split('@')[1];
      var step = 0;
      const COMM = [
        'helo ' + options.host + '\n',
        'mail from:<' + options.from + '>\n',
        'rcpt to:<' + email + '>\n'
      ];
      var ps = []
      for(var i = 0; i < addresses.length; i++){
        // NOTE: using let for variable scope
        let address = addresses[i]
        var p = new Promise(function (resolve, reject) {
          console.log('trying:' + address)
          var socket = net.createConnection(25, address);
          socket.setTimeout(options.timeout, function () {
            console.log('timeout:' + address)
            socket.destroy();
            resolve(false);
          });
          socket.on('data', function (data) {
            if (data.toString()[0] !== '2') {
              console.log(data.toString())
              socket.destroy();
              reject(new Error('refuse'));
            }
            if (step < 3) {
              socket.write(COMM[step], function () {
                step++;
              });
            } else {
              socket.destroy();
              resolve(true);
            }
          });
          socket.on('error', function (err) {
            socket.destroy();
            if (err.code === 'ECONNRESET') {
              reject(new Error('refuse'));
            } else {
              reject(err);
            }
          })
        })
        
        ps.push( p )
      }
      console.log('After create promises')

      return ps.reduce(function(prev, current, index){
        return prev.then(function(res){
          console.log(index)
          
          if(res === true){
            console.log(index + '->fake next')
            return Promise.resolve(true)
          }
          console.log(index + '->reall next')
          return current
        }).catch(function(err){
          console.log('prev.catch')
          console.error(err)
          // return Promise.reject(err)
          return Promise.resolve(false)
        })
      }, Promise.resolve(false));
    })
    .catch(function (err) {
      if (err.message === 'wrong') {
        return false;
      } else {
        throw err;
      }
    })
};
