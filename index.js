'use strict';

var https = require('https');
var queryString = require('querystring');
var crypto = require('crypto');

/**
 * Initialisation sequence is as follows:
 *    access_token, refresh_token = authenticate(username, password)
 *    consumer_id = get_user_info(access_token)
 *    devices_id = get_devices(access_token, consumer_id)
 * One a device id has been derived it can be used to set the mode/temp:
 *    set_mode_and_temperature(deviceid, mode, temp)
 */
var ZenClient = function(config) {

    if (!(this instanceof ZenClient)) {
        return new ZenClient(config);
    }

    var self = this;

    var config = config || {};
    config.api_host = config.api_host || 'wifi.zenhq.com';

    var access_token = null;
    var refresh_token = null;

    // tokens are protected and persisted outside of this client
    self.set_tokens = function(access_token, refresh_token) {
        self.access_token = access_token;
        self.refresh_token = refresh_token;
    }

    self.get_tokens = function() {
        return {
            access_token  : self.access_token,
            refresh_token : self.refresh_token
        }
    }

    self.get_device_list = function(consumer_id, callback) {
        self.request_with_access_token(
            'GET', 
            "/api/v1/consumer/device/getall?consumerId=" + consumer_id,
            '',
            function(e, data) {
                var devices = JSON.parse(data);
                callback(e, devices);
            }
        );
    }

    /*
    { "id":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxx",
      "name":"Heating",
      "mode":1,
      "fanMode":2,
      "relayStates":{"w1":false,"w2":false,"y1":false,"y2":false,"g":false},
      "currentTemperature":22.2,
      "heatingSetpoint":18,
      "coolingSetpoint":22.5,
      "lastIngressUpdateDateTime":"2021-05-02T05:43:00.338408+00:00",
      "hubMacAddress":null,
      "locationId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxx",
      "activeSchedule":{"scheduleId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxx","scheduleState":2,"scheduleResumeTime":null,"isOnHold":true},
      "powerMode":3,
      "isOnline":true,
      "hasRequestedState":false,
      "isOnCWire":true,
      "provisionedDateTime":"2018-12-22T04:26:19.19+00:00","deviceTags":[],"statusRefreshPeriod":0
    } */
    self.get_device_status = function(device_id, callback) {
        self.request_with_access_token(
            'GET', 
            "/api/v1/device/status?deviceId=" + device_id,
            '',
            function(e, data) {
                var status = JSON.parse(data);
                callback(e, status);
            }
        );
    }

    self.get_user_info = function(callback) {
        self.request_with_access_token(
            'GET', 
            "/api/v1/account/userinfo",
            '',
            function(e, data) {
                var user_info = JSON.parse(data);
                callback(e, user_info);
            }
        );
    }

    self.get_consumer_id = function(callback) {
        self.get_user_info(function(e, data) {
            var user_info = JSON.parse(data);
            consumer_id = user_info.consumerId;
            callback(e, consumer_id);
        });
    }

    // @TODO: default and error
    self.get_url_for_mode = function(mode) {
        var url = '';
        switch(mode) {
            case 'heat':
                url = '/api/v1/device/heat'; 
                break;
            case 'emergency_heat': 
                url = '/api/v1/device/emergency/heat';
                break;
            case 'cool':
                url = '/api/v1/device/cool';
                break;
            case 'off':
                url = '/api/v1/device/off';
                break;
        }
        return url;
    }

    // @TODO: default and error
    self.get_mode_as_string = function(mode) {
        var s = '';
        switch(parseInt(mode)) {
            case 0: s = 'unknown'; break;
            case 1: s = 'heat';    break;
            case 2: s = 'cool';    break;
            case 3: s = 'off';     break;
            case 4: s = 'auto';    break;
            case 5: s = 'eco';     break;
            case 6: s = 'emergency_heat'; break;
            case 7: s = 'zen'; break;
        }
        return s;
    }

    // Set mode: { heat, emergency_heat, cool, off} and temperature
    self.set_mode_and_temperature = function(device_id, mode, temperature_as_celsius, callback) {

        var post_data;
        if (mode === 'off') {
            post_data = JSON.stringify({
                deviceid: device_id
            });
        }
        else {
            post_data = JSON.stringify({
                deviceid: device_id,
                setpoint: temperature_as_celsius
            });
        }

        self.request_with_access_token(
            'POST',
            self.get_url_for_mode(mode),
            post_data,
            function(e, data) {
                callback(e, data);
            }
        );
    }

    // On authorisation failure, attempts reauthetication using 
    // grant_type: refresh_token, if that fails.
    self.request_with_access_token = function(method, path, post_data, callback) {

        if (self.access_token == null || self.refresh_token == null) {
            callback("Invalid tokens", null);
            return;
        }

        var options = {
            rejectUnauthorized: true,
            method:  method,
            host:    config.api_host,
            port:    443,
            path:    path,
            headers: {
                'Authorization': 'Bearer ' + self.access_token,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        var req = https.request(options, function(resp) {
            var data = '';
            resp.on('data', function(chunk) {
                data += chunk;
            });
            resp.on('end', function(chunk) {
                callback(null, data);
            });
        }).on("error", function(e) {
            // attempt to reauthenticate using refresh token
            // @TODO:
            callback(e, null);
        });

        req.write(post_data);
        req.end();
    }

    // get oauth2 tokens given username, password
    self.authenticate = function(username, password, callback) {

        var postData = queryString.stringify({
            grant_type: "password",
            username: username,
            password: password
        });

        var options = {
            rejectUnauthorized: true,
            method: 'POST',
            host: config.api_host,
            port: 443,
            path: "/api/token",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length,
                'Accept': 'application/json',
                'q': '0.9'
            }
        };

        var req = https.request(options, function(resp) {
            var data = '';
            resp.on('data', function(chunk) {
                data += chunk;
            });
            resp.on('end', function(chunk) {
                var tokens = JSON.parse(data);
                self.access_token = tokens.access_token;
                self.refresh_token = tokens.refresh_token;
                callback(null, tokens);
            });
        }).on("error", function(e) {
            callback(e, data);
        });

        req.write(postData);
        req.end();
    }

}

module.exports = ZenClient;
