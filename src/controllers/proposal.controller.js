// src/controllers/proposal.controller.js
const proposalService = require('../services/proposal.service');
const logger = require('../utils/logger');

async function createProposal(req, res, next) {
  try {
    const { type, title, description, targetRef, payload } = req.body || {};
    const result = await proposalService.createProposal({
      type, title, description, targetRef, payload, creatorUserId: req.user.sub,
    });
    res.status(201).json({ success: true, data: result.proposal, note: result.note });
  } catch (err) {
    logger.error('createProposal failed', { error: err.message });
    next(err);
  }
}

async function signProposal(req, res, next) {
  try {
    const proposal = await proposalService.signProposal({ id: req.params.id, signerUserId: req.user.sub });
    res.json({ success: true, data: proposal });
  } catch (err) {
    logger.error('signProposal failed', { error: err.message, id: req.params.id });
    next(err);
  }
}

async function rejectProposal(req, res, next) {
  try {
    const proposal = await proposalService.rejectProposal({ id: req.params.id, adminUserId: req.user.sub });
    res.json({ success: true, data: proposal });
  } catch (err) {
    next(err);
  }
}

async function listProposals(req, res, next) {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const result = await proposalService.listProposals({ page, limit, status, type });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function getProposal(req, res, next) {
  try {
    const proposal = await proposalService.getProposal(req.params.id);
    res.json({ success: true, data: proposal });
  } catch (err) {
    next(err);
  }
}

module.exports = { createProposal, signProposal, rejectProposal, listProposals, getProposal };
