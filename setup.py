from setuptools import setup

setup(
    name = 'raceways',
#    packages=['raceways'],
    install_requires = [
        'identity-toolkit-python-client',
        'urllib3'
        'webapp2',
        'stravalib',
        ],
    license="MIT",
    version="0.1",
    description="View your paths in 3d",
    author="Alec Flett",
    )
        
