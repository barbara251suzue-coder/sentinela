export class ErrorHttp extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
