'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const axios = require('axios').default;
const Json2iob = require('json2iob');
class Delonghi extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: 'delonghi',
    });
    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
    this.deviceArray = [];
    this.json2iob = new Json2iob(this);
    this.requestClient = axios.create({});
    this.etags = {};
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Reset the connection indicator during startup
    this.setState('info.connection', false, true);
    if (this.config.interval < 0.5) {
      this.log.info('Set interval to minimum 0.5');
      this.config.interval = 0.5;
    }
    if (!this.config.username || !this.config.password) {
      this.log.error('Please set username and password in the instance settings');
      return;
    }

    this.updateInterval = null;
    this.session = {};
    this.subscribeStates('*');
    await this.login();
    this.log.info('Get devices');
    await this.getDevices();
    await this.updateDevices();

    this.updateInterval = setInterval(async () => {
      await this.updateDevices();
    }, this.config.interval * 60 * 1000);

    //every 1 week
    this.refreshTokenInterval = setInterval(async () => {
      await this.getDevices();
    }, 1000 * 60 * 60 * 24 * 7);
  }
  async login() {
    const sessionInfo = await this.requestClient({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://accounts.eu1.gigya.com/accounts.login',
      params: {
        apiKey: '3_e5qn7USZK-QtsIso1wCelqUKAK_IVEsYshRIssQ-X-k55haiZXmKWDHDRul2e5Y2',
        httpStatusCodes: 'true',
        include: 'profile,id_token,data,preferences',
        loginID: this.config.username,
        password: this.config.password,
        sessionExpiration: '7776000',
        targetEnv: 'mobile',
      },
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        'user-agent': 'delonghi/4.7.0 (com.delonghi.smartcoffee; build:13; iOS 15.8.3) Alamofire/5.8.0',
        'accept-language': 'de-DE;q=1.0',
      },
      data: null,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        return res.data.sessionInfo;
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
    await this.requestClient({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://accounts.eu1.gigya.com/accounts.getJWT',
      params: {
        apiKey: '3_e5qn7USZK-QtsIso1wCelqUKAK_IVEsYshRIssQ-X-k55haiZXmKWDHDRul2e5Y2',
        expiration: '7776000',
        httpStatusCodes: 'true',
        secret: sessionInfo.sessionSecret,
      },
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        authorization: 'Bearer ' + sessionInfo.sessionToken,
        'user-agent': 'delonghi/4.7.0 (com.delonghi.smartcoffee; build:13; iOS 15.8.3) Alamofire/5.8.0',
        'accept-language': 'de-DE;q=1.0',
      },
      data: null,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        this.id_token = res.data.id_token;
      })
      .catch((error) => {
        this.log.error('Login failed first step');
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
    await this.requestClient({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://user-field-eu.aylanetworks.com/api/v1/token_sign_in',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'delonghi/13 CFNetwork/1335.0.3.4 Darwin/21.6.0',
        'accept-language': 'de-DE,de;q=0.9',
      },
      data: {
        app_secret: 'DLonghiCoffeeIdKit-HT6b0VNd4y6CSha9ivM5k8navLw',
        app_id: 'DLonghiCoffeeIdKit-sQ-id',
        token: this.id_token,
      },
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;
        this.setState('info.connection', true, true);
        this.log.info('Login successful');
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }
  async getDevices() {
    await this.requestClient({
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://ads-eu.aylanetworks.com/apiv1/devices.json',
      headers: {
        accept: '*/*',
        'user-agent': 'delonghi/4.7.0 (iPhone; iOS 15.8.3; Scale/2.00)',
        'accept-language': 'de-DE;q=1',
        authorization: 'auth_token ' + this.session.access_token,
      },
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));
        for (let device of res.data) {
          device = device.device;
          const id = device.dsn;
          const name = device.product_name;
          this.deviceArray.push(id);
          await this.extendObject(id, {
            type: 'device',
            common: {
              name: name,
            },
            native: {},
          });
          await this.extendObject(id + '.general', {
            type: 'channel',
            common: {
              name: 'General',
            },
            native: {},
          });
          await this.extendObject(id + '.status', {
            type: 'channel',
            common: {
              name: 'Status',
            },
            native: {},
          });
          await this.extendObject(id + '.remote', {
            type: 'channel',
            common: {
              name: 'Remote Controls',
            },
            native: {},
          });

          const remoteArray = [{ command: 'Refresh', name: 'True = Refresh' }];
          remoteArray.forEach((remote) => {
            this.extendObject(id + '.remote.' + remote.command, {
              type: 'state',
              common: {
                name: remote.name || '',
                type: remote.type || 'boolean',
                role: remote.role || 'boolean',
                def: remote.def == null ? false : remote.def,
                write: true,
                read: true,
              },
              native: {},
            });
          });
          this.json2iob.parse(id + '.general', device, { channelName: 'General Information' });
        }
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }

  async updateDevices() {
    for (const deviceId of this.deviceArray) {
      await this.requestClient({
        method: 'get',
        maxBodyLength: Infinity,
        url: 'https://ads-eu.aylanetworks.com/apiv1/dsns/' + deviceId + '/properties.json',
        headers: {
          accept: '*/*',
          'user-agent': 'delonghi/4.7.0 (iPhone; iOS 15.8.3; Scale/2.00)',
          'accept-language': 'de-DE;q=1',
          authorization: 'auth_token ' + this.session.access_token,
        },
      })
        .then(async (res) => {
          this.log.debug(JSON.stringify(res.data));
          this.replacepropertyTagWithChildren(res.data);
          await this.json2iob.parse(deviceId + '.status', res.data, {
            preferedArrayName: 'name',
            channelName: 'Status',
            parseBase64byIdsToHex: ['value'],
          });
        })
        .catch((error) => {
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
        });
    }
  }
  replacepropertyTagWithChildren(json) {
    //replace attributes tag with children
    for (const key in json) {
      if (key === 'property') {
        for (const attribute in json[key]) {
          json[attribute] = json[key][attribute];
        }
        delete json[key];
      } else if (typeof json[key] === 'object') {
        this.replacepropertyTagWithChildren(json[key]);
      }
    }
  }
  async refreshToken() {
    await this.requestClient({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://user-field-eu.aylanetworks.com/api/v1/token_sign_in',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'delonghi/13 CFNetwork/1335.0.3.4 Darwin/21.6.0',
        'accept-language': 'de-DE,de;q=0.9',
      },
      data: {
        app_secret: 'DLonghiCoffeeIdKit-HT6b0VNd4y6CSha9ivM5k8navLw',
        app_id: 'DLonghiCoffeeIdKit-sQ-id',
        refreshToken: this.session.refresh_token,
      },
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;
        this.setState('info.connection', true, true);
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
        this.log.error('Refresh token failed');
        this.setState('info.connection', false, true);
      });
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  async onUnload(callback) {
    try {
      this.setState('info.connection', false, true);
      this.updateInterval && clearInterval(this.updateInterval);
      callback();
    } catch (e) {
      this.log.error(e);
      callback();
    }
  }

  /**
   * Is called if a subscribed state changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  async onStateChange(id, state) {
    if (state) {
      if (!state.ack) {
        // const projectId = id.split('.')[2];
        // const deviceId = id.split('.')[3];
        let command = id.split('.')[5];
        if (id.split('.')[4] !== 'remote') {
          const length = id.split('.').length;
          command = id.split('.')[length - 1];
        }

        if (command === 'Refresh') {
          this.updateDevices();
          return;
        }
      }
    }
  }
}
if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = (options) => new Delonghi(options);
} else {
  // otherwise start the instance directly
  new Delonghi();
}
