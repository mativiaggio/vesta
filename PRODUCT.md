# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated to the agent per the user: Vite + React + TypeScript for the shared UI and Tauri 2 for the desktop shell. The server framework and package manager for server code remain open decisions.

## Users

Independent professionals who need a focused place to organize their work.

## Product Purpose

Vesta brings tasks, documents, and client work into one quiet digital office so independent professionals can return to their billable work.

## Capabilities and Constraints

Vesta supports email/password authentication and user-owned workspaces with a name, accent color, and identifying icon. The first sign-in creates a workspace; returning users resume their most recently used workspace. Workspaces and client records use the authenticated PostgreSQL API in web and connected Tauri, with durable IndexedDB replicas and queued offline mutations. Packaged local Tauri stores workspaces and clients in the selected SQLite folder without an account or API. Client records support code, name, active state, audit metadata, and soft deletion. Tasks and documents are not implemented yet.

## Brand Commitments

The product is named Vesta. The user supplied `C:/Users/matia/Downloads/logo-vesta.svg` and a sign-up screen reference at `C:/Users/matia/Downloads/VestaLogin.png`. The screen should support light and dark application themes; the supplied design keeps the brand panel dark.

## Evidence on Hand

The supplied logo and screen capture are visual references. No customer evidence, metrics, or testimonials have been provided.

## Product Principles

- Keep the workspace focused on useful work.
- Favor simplicity, reliability, privacy, and portability.
- Support self-hosted and managed deployments with the same core product.
- Treat offline use and durable persistence as core product requirements.
