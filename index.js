'use strict';

var https = require('https');
var appError = require('./error.js');

/**
 * Initialisation sequence is as follows:
 *    access_token, refresh_token = authenticate(username, password)
 *    consumer_id = get_user_info(access_token)
 *    devices_id = get_devices(access_token, consumer_id)
 * Once a device id has been derived, it can be used to set the mode/temp:
 *    set_mode_and_temperature(deviceid, mode, temp)
 */
class ZenClient {
    constructor(config) {
        this.config = config || {};
        if (config && 'api_host' in config)
            this.config.api_host = config.api_host;
        else
            this.config.api_host = 'wifi.zenhq.com';

        this.access_token = null;
        this.refresh_token = null;
    }

    // tokens are expected to be protected and persisted outside of this client
    set_tokens(access_token, refresh_token) {
        this.access_token = access_token;
        this.refresh_token = refresh_token;
    }

    get_tokens() {
        return {
            access_token: this.access_token,
            refresh_token: this.refresh_token
        }
    }

    get_device_list(consumer_id, callback) {
        this.request_with_access_token_with_retry(
            'GET',
            "/api/v1/consumer/device/getall?consumerId=" + consumer_id,
            '',
            function (e, data) {
                var devices = JSON.parse(data);
                callback(e, devices);
            }
        );
    };

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
    get_device_status(device_id, callback) {
        this.request_with_access_token_with_retry(
            'GET',
            "/api/v1/device/status?deviceId=" + device_id,
            '',
            function (e, data) {
                var status = JSON.parse(data);
                callback(e, status);
            }
        );
    };

    get_user_info(callback) {
        this.request_with_access_token_with_retry(
            'GET',
            "/api/v1/account/userinfo",
            '',
            function (e, data) {
                var user_info = JSON.parse(data);
                callback(e, user_info);
            }
        );
    };

    get_consumer_id(callback) {
        this.get_user_info(function (e, data) {
            var user_info = JSON.parse(data);
            consumer_id = user_info.consumerId;
            callback(e, consumer_id);
        });
    };

    // @TODO: default and error
    get_url_for_mode(mode) {
        var url = '';
        switch (mode) {
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
    };

    // @TODO: default and error
    get_mode_as_string(mode) {
        var s = '';
        switch (parseInt(mode)) {
            case 0: s = 'unknown'; break;
            case 1: s = 'heat'; break;
            case 2: s = 'cool'; break;
            case 3: s = 'off'; break;
            case 4: s = 'auto'; break;
            case 5: s = 'eco'; break;
            case 6: s = 'emergency_heat'; break;
            case 7: s = 'zen'; break;
        }
        return s;
    };

    // Set mode: { heat, emergency_heat, cool, off} and temperature
    set_mode_and_temperature(device_id, mode, temperature_as_celsius, callback) {
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

        this.request_with_access_token_with_retry(
            'POST',
            this.get_url_for_mode(mode),
            post_data,
            function (e, data) {
                callback(e, data);
            }
        );
    };

    // On authorisation failure, attempts reauthetication using 
    // grant_type: refresh_token, if that fails return error.
    request_with_access_token_with_retry(method, path, post_data, callback) {
        this.request_with_access_token(method, path, post_data, (e, data)=> {
            if (e) {
                // attempt refresh token grant
                this.refresh_token_grant((e, data)=> {
                    if (e) {
                        // refresh token failed, return error
                        callback(e, null);
                    }
                    else {
                        // refresh token grant successful, so retry api request
                        this.request_with_access_token(method, path, post_data, (e, data)=> {
                            if (e) {
                                // fresh access token failed, return error
                                callback(e, null);
                            }
                            else {
                                callback(e, data);
                            }
                        });
                    }
                })
            }
            else {
                callback(e, data);
            }
        });
    }

    // invoke API using access token 
    request_with_access_token(method, path, post_data, callback) {
        if (this.access_token == null || this.refresh_token == null) {
            callback("No available tokens", null);
            return;
        }

        var options = {
            rejectUnauthorized: true,
            method: method,
            host: this.config.api_host,
            port: 443,
            path: path,
            headers: {
                'Authorization': 'Bearer ' + this.access_token,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        var req = https.request(options, function (resp) {
            var data = '';
            resp.on('data', function (chunk) {
                data += chunk;
            });
            resp.on('end', function (chunk) {
                if (resp.statusCode === 200) {
                    callback(null, data);
                }
                else {
                    var authError = new appError.AuthError('Access token invalid',
                        resp.statusCode, JSON.parse(data));
                    callback(authError);
                }
            });
        }).on("error", function (e) {
            callback(e, null);
        });

        req.write(post_data);
        req.end();
    };

    // use refreshtoken to get new access and refresh tokens
    refresh_token_grant(callback) {
        var postData = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.refresh_token
        }).toString();

        var options = {
            rejectUnauthorized: true,
            method: 'POST',
            host: this.config.api_host,
            port: 443,
            path: '/api/token',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length,
                'Accept': 'application/json'
            }
        };

        var self = this;
        var req = https.request(options, function (resp) {
            var data = '';
            resp.on('data', function (chunk) {
                data += chunk;
            });
            resp.on('end', function (chunk) {
                if (resp.statusCode === 200) {
                    var tokens = JSON.parse(data);
                    self.access_token = tokens.access_token;
                    self.refresh_token = tokens.refresh_token;
                    callback(null, tokens);
                }
                else {
                    var authError = new appError.AuthError('Refresh token failed',
                        resp.statusCode, JSON.parse(data));
                    callback(authError);
                }
            });
        }).on("error", function (e) {
            callback(e, null);
        });

        req.write(postData);
        req.end();
    };

    // get oauth2 tokens given username, password
    authenticate(username, password, callback) {
        var self = this;

        var postData = new URLSearchParams({
            grant_type: "password",
            username:   username,
            password:   password
        }).toString();

        var options = {
            rejectUnauthorized: true,
            method: 'POST',
            host: this.config.api_host,
            port: 443,
            path: "/api/token",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length,
                'Accept': 'application/json',
                'q': '0.9'
            }
        };

        var req = https.request(options, (resp)=> {
            var data = '';
            resp.on('data', (chunk)=> {
                data += chunk;
            });
            resp.on('end', (chunk)=> {
                if (resp.statusCode === 200) {
                    var tokens = JSON.parse(data);
                    self.access_token = tokens.access_token;
                    self.refresh_token = tokens.refresh_token;
                    callback(null, tokens);
                }
                else {
                    var authError = new appError.AuthError('Authentication failed',
                        resp.statusCode, JSON.parse(data));
                    callback(authError);
                }
            });
        });

        req.on('error', (e)=> {
            callback(e);
        });

        req.write(postData);
        req.end();
    };
}

module.exports = ZenClient;
