import { inject as service } from '@ember/service';
import Component from '@ember/component';
import { computed } from '@ember/object';
import RSVP from 'rsvp';
import Log from 'nomad-ui/utils/classes/log';
import timeout from 'nomad-ui/utils/timeout';

export default Component.extend({
  token: service(),

  classNames: ['boxed-section', 'task-log'],

  allocation: null,
  task: null,
  file: null,
  stat: null, // { Name, IsDir, Size, FileMode, ModTime, ContentType }

  // When true, request logs from the server agent
  useServer: false,

  // When true, logs cannot be fetched from either the client or the server
  noConnection: false,

  clientTimeout: 1000,
  serverTimeout: 5000,

  mode: 'head',

  fileComponent: computed('stat', function() {
    // TODO: Switch to this.stat.ContentType
    // TODO: Determine binary/unsupported non-text files to set to "cannot view" component
    const matches = this.stat.Name.match(/^.+?\.(.+)$/);
    const ext = matches ? matches[1] : '';

    switch (ext) {
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'png':
        return 'image';
      default:
        return 'stream';
    }
  }),

  isLarge: computed('stat', function() {
    return this.stat.Size > 50000;
  }),

  isStreamable: computed('stat', function() {
    return true;
    return this.stat.ContentType.startsWith('text/');
  }),

  isStreaming: false,

  catUrl: computed('allocation.id', 'task.name', 'file', function() {
    return `/v1/client/fs/cat/${this.allocation.id}?path=${this.task.name}/${this.file}`;
  }),

  fetchMode: computed('isLarge', 'mode', function() {
    if (!this.isLarge) {
      return 'cat';
    } else if (this.mode === 'head' || this.mode === 'tail') {
      return 'readat';
    }

    return 'stream';
  }),

  fileUrl: computed(
    'allocation.id',
    'allocation.node.httpAddr',
    'fetchMode',
    'useServer',
    function() {
      const address = this.get('allocation.node.httpAddr');
      const url = `/v1/client/fs/${this.fetchMode}/${this.allocation.id}`;
      return this.useServer ? url : `//${address}${url}`;
    }
  ),

  fileParams: computed('task.name', 'file', 'mode', function() {
    const path = `${this.task.name}/${this.file}`;

    switch (this.mode) {
      case 'head':
        return { path, offset: 0, limit: 50000 };
      case 'tail':
        return { path, offset: this.stat.Size - 50000, limit: 50000 };
      case 'streaming':
        return { path, offset: 50000, origin: 'end' };
      default:
        return { path };
    }
  }),

  logger: computed('fileUrl', 'fileParams', 'mode', function() {
    // The cat and readat APIs are in plainText while the stream API is always encoded.
    const plainText = this.mode === 'head' || this.mode === 'tail';

    // If the file request can't settle in one second, the client
    // must be unavailable and the server should be used instead
    const timing = this.useServer ? this.serverTimeout : this.clientTimeout;
    const logFetch = url =>
      RSVP.race([this.token.authorizedRequest(url), timeout(timing)]).then(
        response => response,
        error => {
          if (this.useServer) {
            this.set('noConnection', true);
          } else {
            this.send('failoverToServer');
            this.stream.perform();
          }
          throw error;
        }
      );

    return Log.create({
      logFetch,
      plainText,
      params: this.fileParams,
      url: this.fileUrl,
    });
  }),

  actions: {
    toggleStream() {
      this.set('mode', 'streaming');
      this.toggleProperty('isStreaming');
    },
    gotoHead() {
      this.set('mode', 'head');
      this.set('isStreaming', false);
    },
    gotoTail() {
      this.set('mode', 'tail');
      this.set('isStreaming', false);
    },
    failoverToServer() {
      this.set('useServer', true);
    },
  },
});
