// Drop-in replacement for the Claude-artifact `window.storage` API,
// backed by the browser's real localStorage so this works on a
// normal deployed website (Vercel, Netlify, etc).
const PREFIX = "swertres_";

export const storage = {
  async get(key) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      if (v === null) return null;
      return { key, value: v };
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
  async delete(key) {
    try {
      localStorage.removeItem(PREFIX + key);
      return { key, deleted: true };
    } catch (e) {
      return null;
    }
  },
};
