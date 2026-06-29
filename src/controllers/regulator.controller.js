const regulatorService = require('../services/regulator.service');
const logger = require('../utils/logger');
const userService = require('../services/user.service');

async function getAllUsersGrouped(req, res, next) {
  try {
    const groupedUsers = await userService.getAllUsersGrouped();    
    res.json({ success: true, data: groupedUsers });
  } catch (err) {
    logger.error('Get all users grouped failed', { error: err.message });
    next(err);
  }
}

async function demoteRegulatorAdmin(req, res, next) {
  try {
    const { userId } = req.body;  
    if (!userService.findUserById) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    } 
    const user = await userService.demoteRegulatorAdmin(userId);
    res.json({ success: true, data: user });
  } catch (err) {
    logger.error('Demote regulator admin failed', { error: err.message });
    next(err);
  } finally {
    // Any cleanup if necessary
  }       
}

async function promoteUserToRegulatorAdmin(req, res, next) {
  try {
    const { userId } = req.body;
    if (!userService.findUserById) {
      return res.status(400).json({ success: false, message: 'userId and regulatorId are required' });
    }
    const user = await userService.promoteUserToRegulatorAdmin(userId);
    res.json({ success: true, data: user });
  } catch (err) {
    logger.error('Promote user to regulator admin failed', { error: err.message });
    next(err);
  } finally {
    // Any cleanup if necessary
  } 
}

async function createRegulator(req, res, next) {
  try {
    const data = req.body;
    const regulator = await regulatorService.createRegulator(data);
    logger.info('Regulator created', { regulatorId: regulator._id });
    res.status(201).json({ success: true, data: regulator });
  } catch (err) {
    logger.error('Regulator creation failed', { error: err.message });
    next(err);
  }
}

async function listRegulators(req, res, next) {
  try {
    const regulators = await regulatorService.listRegulators();
    res.json({ success: true, data: regulators });
  } catch (err) {
    next(err);
  }
}

async function getRegulator(req, res, next) {
  try {
    const { id } = req.params;
    const regulator = await regulatorService.getRegulatorById(id);
    if (!regulator) return res.status(404).json({ success: false, message: 'Regulator not found' });
    res.json({ success: true, data: regulator });
  } catch (err) {
    next(err);
  }
}



module.exports = { createRegulator, listRegulators, getRegulator, promoteUserToRegulatorAdmin,demoteRegulatorAdmin, getAllUsersGrouped };
