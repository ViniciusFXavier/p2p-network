// Se estivermos em Node.js e não houver globalThis.crypto, usa o crypto.webcrypto
if (typeof window === 'undefined' && typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}

export class AESCrypto {
  constructor() {
    this.key = null;
  }

  /**
   * Gera uma chave simétrica AES-GCM de 256 bits.
   */
  async generateKey() {
    this.key = await crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true, // chave exportável
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Exporta a chave AES no formato raw e converte para Base64.
   */
  async exportKey() {
    const rawKey = await crypto.subtle.exportKey("raw", this.key);
    console.log('rawKey: ', rawKey);
    return AESCrypto.bufferToBase64(rawKey);
  }

  /**
   * Importa uma chave AES a partir de uma string Base64.
   * @param {string} base64Key - Chave AES em Base64.
   */
  async importKey(base64Key) {
    const rawKey = AESCrypto.base64ToArrayBuffer(base64Key);
    this.key = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Encripta uma mensagem usando AES-GCM.
   * Gera um IV aleatório de 12 bytes e concatena-o com o ciphertext.
   * @param {string} message - Mensagem a ser encriptada.
   * @returns {Uint8Array} - Vetor contendo o IV seguido do ciphertext.
   */
  async encryptMessage(message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);

    // Gera um IV aleatório de 12 bytes (padrão para AES-GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.key,
      data
    );

    // Concatena o IV com o ciphertext para facilitar a decriptação
    const ivAndCipher = new Uint8Array(iv.length + encrypted.byteLength);
    ivAndCipher.set(iv, 0);
    ivAndCipher.set(new Uint8Array(encrypted), iv.length);
    return ivAndCipher;
  }

  /**
   * Decripta uma mensagem que foi encriptada com AES-GCM.
   * Espera receber um Uint8Array com os primeiros 12 bytes correspondentes ao IV.
   * @param {Uint8Array} ivAndCipher - Vetor contendo o IV seguido do ciphertext.
   * @returns {string|null} - Mensagem decriptada ou null se ocorrer erro.
   */
  async decryptMessage(ivAndCipher) {
    // Extrai o IV (primeiros 12 bytes) e o ciphertext (restante)
    const iv = ivAndCipher.slice(0, 12);
    const ciphertext = ivAndCipher.slice(12);
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        this.key,
        ciphertext
      );
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error("Erro na decriptação:", error);
      return null;
    }
  }

  /**
   * Converte um ArrayBuffer para uma string Base64.
   */
  static bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }

  /**
   * Converte uma string Base64 para ArrayBuffer.
   */
  static base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Método demonstrativo de geração de chave, encriptação e decriptação.
   */
  async demo() {
    // Cria uma instância e gera a chave AES
    const aes = new AESCrypto();
    await aes.generateKey();
    const exportedKey = await aes.exportKey();
    console.log("Chave AES gerada (Base64):", exportedKey);

    // Exemplo: encriptação de uma mensagem
    const mensagem = "Olá, mundo AES!";
    const mensagemCriptografada = await aes.encryptMessage(mensagem);
    console.log("Mensagem criptografada (Uint8Array):", mensagemCriptografada);

    // Decriptação da mensagem
    const mensagemDecriptografada = await aes.decryptMessage(mensagemCriptografada);
    console.log("Mensagem decriptografada:", mensagemDecriptografada);
  }
}
