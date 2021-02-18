aiortc web-platform-tests demo
==============================

Create a virtual environment and install the required packages:

.. code-block:: console

    $ python3 -m venv env
    $ source env/bin/activate
    $ pip install -r requirements.txt

Run the server:

.. code-block:: console

    $ uvicorn demo:app

Point your browser to http://localhost:8000/
