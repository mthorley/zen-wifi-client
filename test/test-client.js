
var expect = require("chai").expect;
var ZenClient = require('../index.js');

/**
 * Refer https://www.chaijs.com/api/bdd/ for cheatsheet
 */

var zc = new ZenClient();

/* to reduce new token generation for each test, consider
var tks = {
    access_token: '<at>',
    refresh_token: '<rt>'
  }

zc.set_tokens(tks.access_token, tks.refresh_token);

and place an x infront of it in tests below to exclude from test run, for example:

xit('should authenticate and issue OAuth tokens' ...)
*/

var username = process.env.ZEN_USERNAME;
var password = process.env.ZEN_PASSWORD;
var consumerId = null;

describe('ZenClient', ()=> {

    before(()=> {
        if (!username || !password) {
            console.log('ZEN_USERNAME and/or ZEN_PASSWORD not set as environment variable(s).');
            process.exit(1);
        }
    });

    describe('authenticate', ()=> {

        it('should authenticate and issue OAuth tokens', (done)=> {
            zc.authenticate(username, password, (e, data)=> {
                expect(e).to.be.null;
                var tks = zc.get_tokens();
                console.log(tks);
                expect(tks.access_token).to.exist;
                expect(tks.refresh_token).to.exist;
                done();
            });
        });

        it('should not authenticate with invalid credentials', (done)=> {
            zc.authenticate('invalid', 'invalid', (e, data)=> {
                expect(data).to.be.undefined;
                expect(e).to.be.an('error');
                expect(e['error']).to.equal('invalid_grant');
                expect(e['error_description']).to.equal('The user name or password is incorrect.');
                done();
            })
        });

        it('should use the refresh token to update the access and refresh tokens', (done)=> {
            var previous = zc.get_tokens();
            zc.refresh_token_grant((e, data)=>{
                expect(e).to.be.null;
                expect(previous.access_token).to.not.equal(zc.access_token);
                expect(previous.refresh_token).to.not.equal(zc.refresh_token);
                done();
            });
        })
    });

    describe('get user info', ()=> {

        it('should get user info', (done)=> {
            zc.get_user_info((e, user_info)=> {
                expect(e).to.be.null;
                expect(user_info).to.have.property("consumerId");
                consumerId = user_info.consumerId;
                expect(consumerId).to.have.lengthOf.above(10);    // some non-zero length will do
                done();
            });
        });

        it('should get user info using refresh token grant even if the access token is invalid/expired', (done)=> {
            zc.access_token = "bad";    // will force refresh token grant flow
            zc.get_user_info((e, user_info)=> {
                expect(e).to.be.null;
                expect(user_info).to.have.property("consumerId");
                consumerId = user_info.consumerId;
                expect(consumerId).to.have.lengthOf.above(10);    // some non-zero length will do
                done();
            });
        });

    });

    describe('get devices', ()=> {

        it('should get device list', (done)=> {
            zc.get_device_list(consumerId, (e, data)=> {
                expect(e).to.be.null;
                expect(data.devices).to.be.an('array').that.is.not.empty;
                deviceId = data.devices[0].id;
                expect(deviceId).to.have.lengthOf.above(10);
                done();
            });
        });

        it('should get device list using refresh token grant even if the access token is invalid/expired', (done)=> {
            zc.access_token = "bad";    // will force refresh token grant flow
            zc.get_device_list(consumerId, (e, data)=> {
                expect(e).to.be.null;
                expect(data.devices).to.be.an('array').that.is.not.empty;
                deviceId = data.devices[0].id;
                expect(deviceId).to.have.lengthOf.above(10);
                done();
            });
        });
    });

});
