export interface PublicService {
  CatalogoGuid: string;
  SucursalGuid?: string;
  Codigo: string;
  Nombre: string;
  Categoria: string;
  Tipo: string;
  Descripcion?: string;
  PrecioBase: number;
  AplicaIva: boolean;
  Disponible24h: boolean;
  HoraInicio?: string;
  HoraFin?: string;
  IconoUrl?: string;
}

export interface PublicBranch {
  SucursalGuid: string;
  CodigoSucursal: string;
  NombreSucursal: string;
  DescripcionSucursal?: string;
  DescripcionCorta?: string;
  TipoAlojamiento: string;
  Estrellas?: number;
  CategoriaViaje?: string;
  Pais: string;
  Provincia?: string;
  Ciudad: string;
  Ubicacion: string;
  Direccion: string;
  CodigoPostal?: string;
  Telefono: string;
  Correo: string;
  Latitud?: number;
  Longitud?: number;
  HoraCheckin?: string;
  HoraCheckout?: string;
  CheckinAnticipado: boolean;
  CheckoutTardio: boolean;
  AceptaNinos: boolean;
  EdadMinimaHuesped?: number;
  PermiteMascotas: boolean;
  SePermiteFumar: boolean;
}

export interface PublicRoom {
  HabitacionGuid: string;
  SucursalGuid: string;
  TipoHabitacionGuid: string;
  NombreSucursal: string;
  DescripcionSucursal?: string;
  DescripcionCortaSucursal?: string;
  TipoAlojamiento: string;
  Pais: string;
  Ciudad: string;
  Direccion: string;
  NombreTipoHabitacion: string;
  NumeroHabitacion: string;
  DescripcionHabitacion?: string;
  TipoCama?: string;
  CapacidadAdultos: number;
  CapacidadNinos: number;
  CapacidadTotal: number;
  AreaM2?: number;
  PrecioPorNoche: number;
  PrecioTotalConImpuestos: number;
  PorcentajeIva: number;
  Moneda: string;
  EstadoHabitacion: string;
  Imagenes: string[];
  Servicios: PublicService[];
}

export interface PublicCustomerData {
  TipoIdentificacion: string;
  NumeroIdentificacion: string;
  Nombres: string;
  Apellidos?: string;
  RazonSocial?: string;
  Correo: string;
  Telefono: string;
  Direccion: string;
}

export interface PublicReservationPayload {
  SucursalGuid: string;
  Cliente: PublicCustomerData;
  FechaInicio: string;
  FechaFin: string;
  OrigenCanalReserva: string;
  Observaciones?: string;
  Habitaciones: Array<{
    HabitacionGuid: string;
    NumAdultos: number;
    NumNinos: number;
  }>;
}

export interface PublicCustomerAuth {
  usuarioGuid: string;
  username: string;
  correo: string;
  nombres: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  roles: string[];
  cliente?: PublicCustomerData;
}

export interface PublicCustomerLoginPayload {
  usernameOrEmail: string;
  password: string;
}

export interface PublicCustomerRegisterPayload extends PublicCustomerData {
  Username?: string;
  Password: string;
}

export interface PublicInvoice {
  FacturaGuid: string;
  NumeroFactura: string;
  TipoFactura: string;
  FechaEmision: string;
  Total: number;
  SaldoPendiente: number;
  Moneda: string;
  Estado: string;
}

export interface PublicReservation {
  ReservaGuid: string;
  CodigoReserva: string;
  EstadoReserva: string;
  SucursalGuid: string;
  ClienteGuid: string;
  FechaReservaUtc: string;
  FechaInicio: string;
  FechaFin: string;
  OrigenCanalReserva: string;
  Observaciones?: string;
  SubtotalReserva: number;
  ValorIva: number;
  TotalReserva: number;
  DescuentoAplicado: number;
  SaldoPendiente: number;
  Factura?: PublicInvoice;
  Habitaciones: Array<{
    ReservaHabitacionGuid: string;
    HabitacionGuid: string;
    FechaInicio: string;
    FechaFin: string;
    NumAdultos: number;
    NumNinos: number;
    PrecioNocheAplicado: number;
    SubtotalLinea: number;
    ValorIvaLinea: number;
    DescuentoLinea: number;
    TotalLinea: number;
    EstadoDetalle: string;
  }>;
}

export interface PublicReviewPayload {
  ReservaGuid: string;
  PuntuacionGeneral: number;
  PuntuacionLimpieza?: number;
  PuntuacionConfort?: number;
  PuntuacionUbicacion?: number;
  PuntuacionInstalaciones?: number;
  PuntuacionPersonal?: number;
  PuntuacionCalidadPrecio?: number;
  TipoViaje?: string;
  ComentarioPositivo?: string;
  ComentarioNegativo?: string;
}

export interface PublicPaymentSimulationPayload {
  FacturaGuid: string;
  MetodoPago: 'TARJETA';
  TitularPago: string;
  Referencia: string;
  Moneda?: string;
}

export interface PublicPayment {
  PagoGuid: string;
  FacturaGuid: string;
  ReservaGuid: string;
  Monto: number;
  MetodoPago: string;
  EstadoPago: string;
  FechaPagoUtc: string;
  Moneda: string;
  Referencia?: string;
  TransaccionExterna?: string;
  CodigoAutorizacion?: string;
}

export interface PublicPaymentSimulationResult {
  Pago: PublicPayment;
  Factura?: PublicInvoice;
  ReservaGuid: string;
}
