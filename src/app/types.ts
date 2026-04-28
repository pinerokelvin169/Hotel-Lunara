import type { ReactNode } from 'react';

export type Role = 'admin' | 'vendedor' | 'cliente';

export interface AuthUser {
  usuarioGuid: string;
  username: string;
  correo: string;
  nombres: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  roles: Role[];
}

export interface LoginPayload {
  usernameOrEmail: string;
  password: string;
}

export interface ApiEnvelope<T> {
  success?: boolean;
  message?: string;
  data: T;
}

export interface PagedMetadata {
  total_resultados: number;
  pagina_actual: number;
  total_paginas: number;
  limite: number;
  tiene_siguiente: boolean;
  tiene_anterior: boolean;
}

export interface PagedResponse<T> {
  status: number;
  message: string;
  metadata: PagedMetadata;
  data: T[];
}

export interface ApiErrorPayload {
  success?: boolean;
  message?: string;
  error?: string;
  details?: string[];
  errors?: string[];
}

export type FieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'date'
  | 'datetime-local'
  | 'time'
  | 'json';

export interface SelectOption {
  label: string;
  value: string | number;
}

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: SelectOption[];
  placeholder?: string;
  helpText?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  createOnly?: boolean;
  updateOnly?: boolean;
}

export interface ColumnConfig<TRecord extends Record<string, unknown>> {
  key: keyof TRecord | string;
  label: string;
  render?: (record: TRecord) => ReactNode;
}

export interface ActionConfig<TRecord extends Record<string, unknown>> {
  key: string;
  label: string;
  method: 'patch' | 'post' | 'delete';
  roles: Role[];
  endpoint: (record: TRecord) => string;
  fields?: FieldConfig[];
  buildPayload?: (values: Record<string, unknown>, record: TRecord, username: string) => Record<string, unknown> | undefined;
  successMessage: string;
  variant?: 'danger' | 'accent' | 'neutral';
}

export interface ResourceConfig<TRecord extends Record<string, unknown>> {
  key: string;
  title: string;
  description: string;
  path: string;
  idField: keyof TRecord | string;
  roles: Role[];
  capabilities: {
    create: boolean;
    update: boolean;
    delete: boolean;
  };
  columns: ColumnConfig<TRecord>[];
  fields: FieldConfig[];
  initialValues: Record<string, unknown>;
  createAuditField?: string;
  updateAuditField?: string;
  prepareCreatePayload?: (values: Record<string, unknown>, username: string) => Record<string, unknown>;
  prepareUpdatePayload?: (values: Record<string, unknown>, username: string) => Record<string, unknown>;
  actions?: ActionConfig<TRecord>[];
}

export interface OperationConfig {
  key: string;
  title: string;
  description: string;
  method: 'get' | 'post' | 'patch';
  roles: Role[];
  fields: FieldConfig[];
  path: (values: Record<string, unknown>) => string;
  buildPayload?: (values: Record<string, unknown>, username: string) => Record<string, unknown> | undefined;
  successMessage: string;
  responseMode?: 'message' | 'data';
}
