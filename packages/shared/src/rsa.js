if (typeof window === 'undefined' && typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}

export class RSACrypto {
  constructor() {
    this.publicKey = null;
    this.privateKey = null;
  }

  /**
   * Gera um par de chaves RSA-OAEP e armazena nas propriedades do objeto.
   */
  async generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048, // limite maximo para criptografia de 2048 bits
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true, // chave exportável
      ["encrypt", "decrypt"]
    );
    this.publicKey = keyPair.publicKey;
    this.privateKey = keyPair.privateKey;
  }

  /**
   * Exporta a chave pública no formato SPKI e converte para Base64.
   */
  async exportPublicKey() {
    const spki = await crypto.subtle.exportKey("spki", this.publicKey);
    return RSACrypto.bufferToBase64(spki);
  }

  /**
   * Encripta uma mensagem usando uma chave pública informada.
   * @param {CryptoKey} publicKey - Chave pública para encriptação.
   * @param {string} message - Mensagem a ser encriptada.
   */
  async encryptMessage(publicKey, message) {
    console.log('publicKey: ', publicKey);
    const encoder = new TextEncoder();
    const encodedMessage = encoder.encode(message);
    console.log('encodedMessage: ', encodedMessage);
    return await crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      encodedMessage
    );
  }

  /**
   * Decripta uma mensagem usando a chave privada armazenada no objeto.
   * @param {ArrayBuffer} ciphertext - Mensagem encriptada.
   */
  async decryptMessage(ciphertext) {
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        this.privateKey,
        ciphertext
      );
      return new TextDecoder().decode(decrypted).toString();
    } catch (error) {
      console.error('error: ', error);
      return ciphertext
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
   * Importa uma chave pública a partir de uma string Base64.
   * @param {string} base64Key - Chave pública em Base64.
   */
  static async importPublicKey(base64Key) {
    const binaryDer = RSACrypto.base64ToArrayBuffer(base64Key);
    return await crypto.subtle.importKey(
      "spki",
      binaryDer,
      {
        name: "RSA-OAEP",
        hash: "SHA-256",
      },
      true,
      ["encrypt"]
    );
  }

  async demo() {
    // Geração dos pares de chaves para cliente e servidor
    const clientCrypto = new RSACrypto();
    const serverCrypto = new RSACrypto();

    await clientCrypto.generateKeyPair();
    await serverCrypto.generateKeyPair();

    // Exporta as chaves públicas para troca (por exemplo, via rede)
    const clientPublicKeyStr = await clientCrypto.exportPublicKey();
    const serverPublicKeyStr = await serverCrypto.exportPublicKey();

    console.log("Chave pública do cliente:", clientPublicKeyStr);
    console.log("Chave pública do servidor:", serverPublicKeyStr);

    // Exemplo: Cliente envia uma mensagem para o servidor
    const mensagem = "Olá, mundo seguro!";

    // O cliente importa a chave pública do servidor para encriptar a mensagem
    const importedServerPublicKey = await RSACrypto.importPublicKey(serverPublicKeyStr);
    const mensagemCriptografada = await clientCrypto.encryptMessage(importedServerPublicKey, mensagem);
    console.log("Mensagem criptografada (em Uint8Array):", new Uint8Array(mensagemCriptografada));

    // O servidor decripta a mensagem com sua chave privada
    const mensagemDecriptografada = await serverCrypto.decryptMessage(mensagemCriptografada);
    console.log("Mensagem decriptografada:", mensagemDecriptografada);
  }
}
