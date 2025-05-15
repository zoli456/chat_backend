// Helper function to check if a feature is enabled
import {Setting} from "../models/models.js";

const isFeatureEnabled = async (featureName) => {
    const setting = await Setting.findOne({ where: { name: featureName } });
    return setting && setting.value === 'true';
};

export  {isFeatureEnabled};