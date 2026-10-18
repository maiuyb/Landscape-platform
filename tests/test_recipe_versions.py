"""Strict publishing boundaries for perspective and the new vignette profile."""
import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / '风景调色协作平台/backend/community_modules/recipe_schema.py'
spec = importlib.util.spec_from_file_location('version_schema', source)
schema = importlib.util.module_from_spec(spec)
spec.loader.exec_module(schema)


class VersionTests(unittest.TestCase):
    def test_perspective_requires_v7_and_rejects_invalid_numeric_or_crop_values(self):
        params = {'vertical': 20, 'horizontal': -15, 'autoCrop': True}
        recipe = {'version': 7, 'steps': [{'type': 'perspective', 'params': params}]}
        normalized, error = schema.validate_recipe(recipe)
        self.assertIsNone(error)
        self.assertEqual(normalized['steps'], recipe['steps'])
        self.assertIsNotNone(schema.validate_recipe({**recipe, 'version': 6})[1])
        for patch in ({'vertical': 61}, {'horizontal': float('nan')}, {'vertical': True}, {'autoCrop': 1}):
            invalid = {**recipe, 'steps': [{'type': 'perspective', 'params': {**params, **patch}}]}
            self.assertIsNotNone(schema.validate_recipe(invalid)[1])

    def test_vignette_profile_enum_and_version_are_strict(self):
        effects = {'clarity': 0, 'dehaze': 0,
                   'calibration': {key: {'hue': 0, 'saturation': 0} for key in ('red', 'green', 'blue')},
                   'vignette': {'amount': -20, 'midpoint': 50, 'feather': 70, 'roundness': 0, 'centerX': 50, 'centerY': 50}}
        def validate(version, profile):
            vignette = {**effects['vignette']}
            if profile is not None:
                vignette['profile'] = profile
            return schema.validate_recipe({'version': version, 'steps': [{'type': 'effects', 'params': {**effects, 'vignette': vignette}}]})[1]
        self.assertIsNone(validate(6, None))
        self.assertIsNone(validate(7, 'corner'))
        self.assertIsNotNone(validate(6, 'corner'))
        self.assertIsNotNone(validate(7, 'unknown'))


if __name__ == '__main__':
    unittest.main()
